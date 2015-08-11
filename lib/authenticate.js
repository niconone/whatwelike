'use strict';

var Boom = require('boom');
var Bcrypt = require('bcrypt');
var postmark = require('postmark');
var uuid = require('uuid');

var conf = require('./conf');
var db = require('./db').register('users');

var updateProfile = function (user, next) {
  var ops = [
    {
      type: 'put',
      key: 'email!' + user.email,
      value: user
    },
    {
      type: 'put',
      key: 'uid!' + user.uid,
      value: user
    }
  ];

  db.batch(ops, function (err) {
    if (err) {
      return next(err);
    }

    next(null, user.password);
  });
};

var updatePassword = function (user, password, next) {
  Bcrypt.genSalt(10, function (err, salt) {
    if (err) {
      return next(err);
    }

    Bcrypt.hash(password, salt, function (err, hash) {
      if (err) {
        return next(err);
      }

      user.password = hash;
      user.resetUID = uuid.v4();
      updateProfile(user, next);
    });
  });
};

exports.get = function (uid, next) {
  db.get('uid!' + uid, function (err, profile) {
    if (err || !profile) {
      return next(new Error('No such user found.'));
    }

    next(null, profile);
  });
};

exports.forgotPassword = function (request, reply) {
  var email = request.payload.email;
  var client = new postmark.Client(conf.get('postmark-key'));

  var resetUID = uuid.v4();

  db.get('email!' + email, function (err, user) {
    if (!err && user) {
      user.resetUID = resetUID;

      updateProfile(user, function (err) {
        if (err) {
          console.log('Could not update user with reset password key');
          reply.redirect('/resetPassword');
        }

        client.sendEmail({
          From: conf.get('postmark-email'),
          To: email,
          Subject: 'What We Like - Password Reset',
          TextBody: 'Click on the link below to reset your password.\n\n' +
                    conf.get('externalDomain') + '/password/reset?uid=' +
                    resetUID + '&email=' + email
        }, function (err) {
          if (err) {
            console.error('Unable to send via postmark: ' + err.message);
            return;
          }
          console.log('sent email to : ', email, conf.get('externalDomain') +
                      '/password/reset?uid=' + resetUID + '&email=' + email);
          reply.redirect('/');
        });
      });
    } else {
      reply.redirect('/password/forgot?err=email+not+found');
    }
  });
};

exports.resetPassword = function (request, reply) {
  var password1 = request.payload.password1;
  var password2 = request.payload.password2;
  var email = request.payload.email;
  var resetUID = request.payload.resetUID;

  if (password1 !== password2) {
    return reply(Boom.wrap(new Error('Passwords do not match'), 400));
  }

  db.get('email!' + email, function (err, user) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    if (user.resetUID !== resetUID) {
      return reply(Boom.wrap(new Error('Invalid reset key'), 400));
    }

    updatePassword(user, password1, function (err) {
      if (err) {
        return reply(Boom.wrap(err, 400));
      }

      reply.redirect('/');
    });
  });
};

exports.signup = function (request, reply) {
  var email = request.payload.email;
  var password = request.payload.password;

  var user = {
    name: email.split('@')[0],
    email: email,
    uid: uuid.v4()
  };

  var addUser = function (hash) {
    user.password = hash;

    updateProfile(user, function (err) {
      if (err) {
        return reply(Boom.wrap(err, 400));
      }

      request.auth.session.set(user);
      reply.redirect('/');
    });
  };

  // If user is found, throw an error, otherwise create a new account
  db.get('email!' + email, function (err, profile) {
    if (profile) {
      return reply(Boom.wrap(new Error('User already exists'), 400));
    }

    updatePassword(user, password, function (err, hash) {
      if (err) {
        return reply(Boom.wrap(err, 400));
      }

      addUser(hash);
    });
  });
};

exports.update = function (request, reply) {
  var name = request.payload.name;
  var password = request.payload.password;

  db.get('email!' + request.auth.credentials.email, function (err, profile) {
    if (err || !profile) {
      return reply(Boom.wrap(new Error('User does not exist'), 400));
    }

    profile.name = name;
    request.auth.credentials.name = name;

    if (password) {
      updatePassword(profile, password, function (err, hash) {
        if (err) {
          return reply(Boom.wrap(err, 400));
        }

        profile.password = hash;

        updateProfile(profile, function (err) {
          if (err) {
            return reply(Boom.wrap(err, 400));
          }

          reply.redirect('/profile?message=password+updated');
        });
      });
    } else {
      updateProfile(profile, function (err) {
        if (err) {
          return reply(Boom.wrap(err, 400));
        }

        reply.redirect('/profile?message=profile+updated');
      });
    }
  });
};

exports.login = function (request, reply) {
  var email = request.payload.email;
  var password = request.payload.password;

  db.get('email!' + email, function (err, user) {
    if (err) {
      return reply(Boom.wrap(new Error('Invalid username or password'), 400));
    }

    Bcrypt.compare(password, user.password, function (err, isValid) {
      if (err || !isValid) {
        return reply(Boom.wrap(new Error('Invalid username or password'), 400));
      }

      request.auth.session.set(user);
      console.log('logging in ', user, request.auth.isAuthenticated);
      reply.redirect('/dashboard');
    });
  });
};

exports.logout = function (request, reply) {
  request.auth.session.clear();
  reply.redirect('/');
};
