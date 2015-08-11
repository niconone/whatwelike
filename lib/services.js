'use strict';

var conf = require('./conf');
var Boom = require('boom');

var posts = require('./posts');
var authenticate = require('./authenticate');

var ctx = {
  analytics: conf.get('analytics'),
  uid: false
};

var setContext = function (request) {
  ctx.session = request.auth.isAuthenticated || false;
  ctx.error = request.query.err || '';
  ctx.message = request.query.message || '';

  if (ctx.session) {
    ctx.uid = request.auth.credentials.uid;
  }
};

exports.home = function (request, reply) {
  if (request.auth.credentials && request.auth.credentials.uid) {
    return reply.redirect('/dashboard');
  }

  setContext(request);

  reply.view('index', ctx);
};

exports.join = function (request, reply) {
  ctx.error = request.query.err || '';
  ctx.email = request.query.email || '';
  reply.view('join', ctx);
};

exports.dashboard = function (request, reply) {
  setContext(request);

  posts.latest(request, function (err, postItems) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    ctx.posts = postItems;

    reply.view('dashboard', ctx);
  });
};

exports.category = function (request, reply) {
  setContext(request);
  ctx.category = request.params.category;

  posts.categoryFeed(ctx.category, function (err, postItems) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    ctx.posts = postItems;

    reply.view('posts', ctx);
  });
};

exports.newThread = function (request, reply) {
  setContext(request);

  reply.view('add', ctx);
};

exports.deletePost = function (request, reply) {
  var key = request.params.key.split('~');

  posts.del({
    uid: request.auth.credentials.uid,
    category: key[0],
    created: key[1],
    pid: key[2]
  }, function (err) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    reply.redirect('/dashboard');
  });
};

exports.edit = function (request, reply) {
  setContext(request);

  posts.get(request.params.key, function (err, post) {
    if (err) {
      return reply(Boom.wrap(err, 404));
    }

    ctx.post = post;

    reply.view('edit', ctx);
  });
};

exports.get = function (request, reply) {
  setContext(request);

  posts.get(request.params.key, function (err, post) {
    if (err) {
      return reply(Boom.wrap(err, 404));
    }

    ctx.isOwner = !!(request.auth.isAuthenticated && request.auth.credentials.uid === post.author);
    ctx.post = post;

    reply.view('post', ctx);
  });
};

exports.forgotPassword = function (request, reply) {
  ctx.error = request.query.err || '';
  ctx.session = request.auth.isAuthenticated || false;
  reply.view('forgot_password', ctx);
};

exports.resetPassword = function (request, reply) {
  ctx.error = request.query.err || '';
  ctx.session = request.auth.isAuthenticated || false;
  ctx.email = request.query.email;
  ctx.resetUID = request.query.uid;
  reply.view('reset_password', ctx);
};

exports.profile = function (request, reply) {
  setContext(request);

  ctx.name = request.auth.credentials.name;
  ctx.email = request.auth.credentials.email;

  reply.view('profile', ctx);
};

exports.user = function (request, reply) {
  setContext(request);

  authenticate.get(request.params.uid, function (err, profile) {
    if (err || !profile) {
      return reply(Boom.wrap(new Error('User not found'), 404));
    }

    posts.userFeed(request.params.uid, function (err, posts) {
      if (err || !posts) {
        ctx.posts = [];
      } else {
        ctx.posts = posts;
      }

      ctx.user = profile;

      reply.view('user', ctx);
    });
  });
};
