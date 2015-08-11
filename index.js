'use strict';

var Hapi = require('hapi');
var Joi = require('joi');
var http = require('http');

var conf = require('./lib/conf');

var authenticate = require('./lib/authenticate');
var services = require('./lib/services');
var posts = require('./lib/posts');

var server = new Hapi.Server();

server.connection({
  host: conf.get('domain'),
  port: conf.get('port')
});

server.views({
  engines: {
    jade: require('jade')
  },
  isCached: process.env.node === 'production',
  path: __dirname + '/views',
  compileOptions: {
    pretty: true
  }
});

server.ext('onPreResponse', function (request, reply) {
  var response = request.response;

  if (!response.isBoom) {
    return reply.continue();
  }

  var error = response;
  var ctx = {};

  var message = error.output.payload.message;
  var statusCode = error.output.statusCode || 500;
  ctx.code = statusCode;
  ctx.httpMessage = http.STATUS_CODES[statusCode].toLowerCase();

  switch (statusCode) {
  case 404:
    ctx.reason = 'page not found';
    break;
  case 403:
    ctx.reason = 'forbidden';
    break;
  case 500:
    ctx.reason = 'something went wrong';
    break;
  default:
    break;
  }

  if (process.env.npm_lifecycle_event === 'dev') {
    console.log(error.stack || error);
  }

  if (ctx.reason) {
    // Use actual message if supplied
    ctx.reason = message || ctx.reason;
    return reply.view('error', ctx).code(statusCode);
  }

  ctx.reason = message.replace(/\s/gi, '+');
  reply.redirect(request.path + '?err=' + ctx.reason);
});

server.register({
  register: require('crumb')
}, function (err) {
  if (err) {
    throw err;
  }
});

server.register([
  {
    register: require('hapi-cache-buster'),
    options: new Date().getTime().toString()
  }
], function (err) {
  console.log(err);
});

var auth = {
  mode: 'try',
  strategy: 'session'
};

server.register(require('hapi-auth-cookie'), function (err) {
  if (err) {
    throw err;
  }

  server.auth.strategy('session', 'cookie', {
    password: conf.get('password'),
    ttl: conf.get('session-ttl'),
    cookie: conf.get('cookie'),
    keepAlive: true,
    isSecure: false
  });
});

var routes = [
  {
    method: 'GET',
    path: '/',
    config: {
      handler: services.home,
      auth: auth
    }
  },
  {
    method: 'GET',
    path: '/signup',
    handler: services.join
  },
  {
    method: 'GET',
    path: '/password/forgot',
    handler: services.forgotPassword
  },
  {
    method: 'GET',
    path: '/password/reset',
    handler: services.resetPassword
  },
  {
    method: 'POST',
    path: '/password/forgot',
    handler: authenticate.forgotPassword
  },
  {
    method: 'POST',
    path: '/password/reset',
    handler: authenticate.resetPassword
  },
  {
    method: 'POST',
    path: '/signup',
    config: {
      handler: authenticate.signup,
      validate: {
        payload: {
          email: Joi.string().email(),
          password: Joi.string().min(6).required()
        }
      }
    }
  },
  {
    method: 'GET',
    path: '/dashboard',
    config: {
      handler: services.dashboard,
      auth: auth
    }
  },
  {
    method: 'GET',
    path: '/login',
    handler: services.home
  },
  {
    method: 'POST',
    path: '/login',
    config: {
      handler: authenticate.login,
      auth: auth,
      plugins: {
        'hapi-auth-cookie': {
          redirectTo: false
        }
      },
      validate: {
        payload: {
          email: Joi.string().email(),
          password: Joi.string().min(6).strip().required()
        }
      }
    }
  },
  {
    method: 'GET',
    path: '/post',
    config: {
      handler: services.newThread,
      auth: auth
    }
  },
  {
    method: 'POST',
    path: '/post',
    config: {
      handler: posts.add,
      auth: auth,
      validate: {
        payload: {
          category: Joi.string().hostname().lowercase().required(),
          title: Joi.string().required(),
          body: Joi.string().required()
        }
      }
    }
  },
  {
    method: 'GET',
    path: '/thread/{key}',
    config: {
      auth: auth
    },
    handler: services.get
  },
  {
    method: 'GET',
    path: '/thread/edit/{key}',
    config: {
      handler: services.edit,
      auth: auth
    }
  },
  {
    method: 'POST',
    path: '/thread/edit/{key}',
    config: {
      auth: auth,
      handler: posts.update
    }
  },
  {
    method: 'POST',
    path: '/thread/delete/{key}',
    config: {
      handler: services.deletePost,
      auth: auth
    }
  },
  {
    method: 'GET',
    path: '/category/{category}',
    config: {
      handler: services.category,
      auth: auth
    }
  },
  {
    method: 'GET',
    path: '/profile',
    config: {
      handler: services.profile,
      auth: auth
    }
  },
  {
    method: 'POST',
    path: '/profile',
    config: {
      handler: authenticate.update,
      auth: auth,
      validate: {
        payload: {
          name: Joi.string().required(),
          password: Joi.any().optional()
        }
      }
    }
  },
  {
    method: 'GET',
    path: '/user/{uid}',
    config: {
      handler: services.user,
      auth: auth
    }
  },
  {
    method: 'GET',
    path: '/logout',
    config: {
      handler: authenticate.logout,
      auth: auth
    }
  },
  {
    method: 'GET',
    path: '/topics',
    config: {
      handler: services.topics,
      auth: auth
    }
  },
  {
    method: 'POST',
    path: '/comment',
    config: {
      handler: services.addComment,
      auth: auth
    }
  },
  {
    method: 'POST',
    path: '/comment/delete/{key}',
    config: {
      handler: services.deleteComment,
      auth: auth
    }
  }
];

server.route(routes);

server.route({
  path: '/{p*}',
  method: 'GET',
  handler: {
    directory: {
      path: './public',
      listing: false,
      index: false
    }
  }
});

server.start(function (err) {
  if (err) {
    console.error(err.message);
    process.exit(1);
  }
});

exports.getServer = function () {
  return server;
};
