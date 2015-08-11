'use strict';

var Boom = require('boom');
var uuid = require('uuid');
var concat = require('concat-stream');
var marked = require('marked');
var moment = require('moment');

var db = require('./db').register('posts');
var authenticate = require('./authenticate');

marked.setOptions({
  renderer: new marked.Renderer(),
  gfm: true,
  tables: true,
  breaks: true,
  pedantic: false,
  sanitize: true,
  smartLists: true,
  smartypants: false
});

var getTopicTotal = function (key, next) {
  var count = 0;
  var rs = db.createKeyStream({
    gte: 'post~' + key + '~',
    lte: 'post~' + key + '~\xff'
  });

  rs.on('data', function (post) {
    count ++;
  });

  rs.on('end', function () {
    next(null, count);
  });

  rs.on('error', function (err) {
    next(err);
  });
};

var addPost = function (opts, next) {
  var created = Date.now();
  var pid = uuid.v4();

  var post = {
    key: opts.category + '~' + created + '~' + pid,
    category: opts.category,
    title: opts.title,
    body: opts.body,
    created: created,
    pid: pid,
    author: opts.author
  };

  var ops = [
    {
      type: 'put',
      key: 'user~' + post.author + '~' + created,
      value: post
    },
    {
      type: 'put',
      key: 'post~' + post.category + '~' + created + '~' + post.pid,
      value: post
    }
  ];

  db.batch(ops, function (err) {
    if (err) {
      return next(err);
    }

    getTopicTotal(post.category, function (err, count) {
      db.put('topic~' + post.category + '~', {
        name: post.category,
        count: count
      }, function (err) {
        if (err) {
          console.log(err);
        }
      });
    });

    next(null, post.key);
  });
};

var getComments = function (post, next) {
  var rs = db.createValueStream({
    gte: 'comment~' + post.category + '~',
    lte: 'comment~' + post.category + '~\xff'
  });

  rs.pipe(concat(function (comments) {
    comments.forEach(function (comment) {
      authenticate.get(comment.author, function (err, profile) {
        if (profile) {
          comment.postedBy = profile.name || profile.uid;
        }

        comment.commentMarked = marked(comment.comment);
        comment.createdFromNow = moment(comment.created).fromNow();
      });
    });

    post.comments = comments;

    next(null, post);
  }));

  rs.on('error', function (err) {
    next(err);
  });
};

exports.add = function (request, reply) {
  var post = {
    category: request.payload.category,
    title: request.payload.title,
    body: request.payload.body,
    author: request.auth.credentials.uid
  };

  addPost(post, function (err, key) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    reply.redirect('/thread/' + key);
  });
};

exports.get = function (key, next) {
  db.get('post~' + key, function (err, post) {
    if (err) {
      return next(err);
    }

    post.bodyMarked = marked(post.body);
    post.postedBy = '';
    post.createdFromNow = moment(post.created).fromNow();

    authenticate.get(post.author, function (err, profile) {
      if (profile) {
        post.postedBy = profile.name || profile.uid;
      }

      getComments(post, next);
    });
  });
};

var runDeleteBatch = function (ops, category, postKey, next) {
  db.batch(ops, function (err) {
    if (err) {
      return next(err);
    }

    var rs = db.createValueStream({
      gte: 'comment~' + postKey + '~',
      lte: 'comment~' + postKey + '~\xff'
    });

    rs.pipe(concat(function (comments) {
      comments.forEach(function (comment) {
        db.del('comment~' + comment.key, function (err) {
          if (err) {
            console.log('could not delete comment: ', err);
          } else {
            console.log('comment deleted');
          }
        });
      });

      db.get('topic~' + category + '~', function (err, topic) {
        if (err) {
          return next(err);
        }

        var count = topic.count - 1;

        if (count < 1) {
          db.del('topic~' + category + '~');
        } else {
          db.put('topic~' + category + '~', {
            name: category,
            count: count
          });
        }
      });

      next(null, true);
    }));

    rs.on('error', function (err) {
      next(err);
    });
  });
};

exports.del = function (opts, next) {
  var postKey = opts.category + '~' + opts.created + '~' + opts.pid;

  db.get('post~' + postKey, function (err, post) {
    if (err) {
      return next(err);
    }

    if (opts.uid != post.author) {
      return next(new Error('No permission to delete this thread'));
    }
  });

  var ops = [
    {
      type: 'del',
      key: 'user~' + opts.uid + '~' + opts.created
    },
    {
      type: 'del',
      key: 'post~' + postKey
    }
  ];

  runDeleteBatch(ops, opts.category, postKey, next);
};

exports.update = function (request, reply) {
  var created = request.payload.created;

  db.get('user~' + request.auth.credentials.uid + '~' + created, function (err, post) {
    if (err) {
      return reply(Boom.wrap(err, 404));
    }

    post.title = request.payload.title;
    post.body = request.payload.body;

    var ops = [
      {
        type: 'put',
        key: 'user~' + post.author + '~' + created,
        value: post
      },
      {
        type: 'put',
        key: 'post~' + post.category + '~' + created + '~' + post.pid,
        value: post
      }
    ];

    db.batch(ops, function (err) {
      if (err) {
        return reply(Boom.wrap(err, 400));
      }

      reply.redirect('/thread/' + post.key);
    });
  });
};

exports.latest = function (request, next) {
  var rs = db.createValueStream({
    gte: 'user~' + request.auth.credentials.uid,
    lte: 'user~' + request.auth.credentials.uid + '\xff',
    limit: 20,
    reverse: true
  });

  rs.pipe(concat(function (posts) {
    posts.forEach(function (post) {
      post.bodyMarked = marked(post.body);
      post.createdFromNow = moment(post.created).fromNow();
    });

    next(null, posts);
  }));

  rs.on('error', function (err) {
    next(err);
  });
};

exports.userFeed = function (uid, next) {
  var rs = db.createValueStream({
    gte: 'user~' + uid,
    lte: 'user~' + uid + '\xff',
    limit: 20,
    reverse: true
  });

  rs.pipe(concat(function (posts) {
    posts.forEach(function (post) {
      post.bodyMarked = marked(post.body);
      post.createdFromNow = moment(post.created).fromNow();
    });

    next(null, posts);
  }));

  rs.on('error', function (err) {
    next(err);
  });
};

exports.topics = function (next) {
  var rs = db.createValueStream({
    gte: 'topic~',
    lte: 'topic~\xff'
  });

  rs.pipe(concat(function (topics) {
    next(null, topics);
  }));

  rs.on('error', function (err) {
    next(err);
  });
};

exports.categoryFeed = function (key, next) {
  var rs = db.createValueStream({
    gte: 'post~' + key + '~',
    lte: 'post~' + key + '~\xff',
    limit: 20,
    reverse: true
  });

  rs.pipe(concat(function (posts) {
    posts.forEach(function (post) {
      post.bodyMarked = marked(post.body);
      post.createdFromNow = moment(post.created).fromNow();
    });

    next(null, posts);
  }));

  rs.on('error', function (err) {
    next(err);
  });
};

exports.addComment = function (opts, next) {
  var created = Date.now();
  var cid = uuid.v4();

  // TODO: banning stuff
  db.get('banned~' + opts.key, function (err, ban) {
    if (ban) {
      return next(new Error('Banned from posting on this thread'));
    }
  });

  var comment = {
    key: opts.replyTo + '~' + created + '~' + cid,
    replyTo: opts.replyTo,
    comment: opts.comment,
    created: created,
    cid: cid,
    author: opts.author
  };

  db.put('comment~' + comment.key, comment, function (err) {
    if (err) {
      return next(err);
    }

    next(null, comment);
  })
};

exports.deleteComment = function (opts, next) {
  db.get('comment~' + opts.key, function (err, comment) {
    if (err) {
      return next(err);
    }

    db.get('post~' + comment.replyTo, function (err, post) {
      if (err) {
        return next(err);
      }

      if (opts.uid != comment.author && opts.uid != post.author) {
        return next(new Error('No permission to delete this comment'));
      }

      db.del('comment~' + opts.key, function (err) {
        if (err) {
          return next(err);
        }

        return next(null, true);
      });
    });
  });
};
