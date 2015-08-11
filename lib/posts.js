'use strict';

var Boom = require('boom');
var uuid = require('uuid');
var concat = require('concat-stream');
var marked = require('marked');

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

var addPost = function (opts, next) {
  var created = Math.floor(Date.now() / 1000);
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

    next(null, post.key);
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

    authenticate.get(post.author, function (err, profile) {
      if (profile) {
        post.postedBy = profile.name || profile.uid;
      }

      next(null, post);
    });
  });
};

exports.del = function (opts, next) {
  var ops = [
    {
      type: 'del',
      key: 'user~' + opts.uid + '~' + opts.created
    },
    {
      type: 'del',
      key: 'post~' + opts.category + '~' + opts.created + '~' + opts.pid
    }
  ];

  db.batch(ops, function (err) {
    if (err) {
      return next(err);
    }

    next(null, true);
  });
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
    });

    next(null, posts);
  }));

  rs.on('error', function (err) {
    next(err);
  });
};

exports.categoryFeed = function (key, next) {
  var rs = db.createValueStream({
    gte: 'post~' + key,
    lte: 'post~' + key + '\xff',
    limit: 20
  });

  rs.pipe(concat(function (posts) {
    posts.forEach(function (post) {
      post.bodyMarked = marked(post.body);
    });

    next(null, posts);
  }));

  rs.on('error', function (err) {
    next(err);
  });
};
