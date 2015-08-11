'use strict';

var level = require('level');
var conf = require('./conf');

var path = conf.get('db') || './db';

var dbs = {};
var options = {};

exports = module.exports = function db (key) {
  if (!dbs[key]) {
    throw new Error('Database not registered: ' + key);
  }
  return dbs[key];
};

exports.register = function (key, opt) {
  if (dbs[key]) {
    throw new Error('Database already registered: ' + key);
  }

  var dbPath = path + '/' + key;
  var db = level(dbPath, {
    createIfMissing: true,
    valueEncoding: 'json'
  });

  dbs[key] = db;
  options[key] = opt;

  return db;
};
