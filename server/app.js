/**
 * Module dependencies.
 */
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const routes = require('./routes');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();

const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const logger = require('morgan');
const errorHandler = require('errorhandler');

// all environments
app.set('port', process.env.PORT || 3000);
app.use(logger('dev'));
app.use(
  bodyParser.urlencoded({
    extended: true
  })
);
app.use(bodyParser.json());
app.use(methodOverride());
app.use('/api', routes);
app.use(express.static(path.join(__dirname, 'build')));
app.get('*', function(req, res) {
  res.sendFile('build/index.html', { root: global });
});

const sess = {
  secret: 'cupidosecretsecret',
  cookie: {},
  resave: false,
  saveUninitialized: true
};
// development only
if ('development' == app.get('env')) {
  app.use(errorHandler());
  app.set('trust proxy', 1); // trust first proxy
  sess.cookie.secure = true; // serve secure cookies
}
app.use(session(sess));

http.createServer(app).listen(app.get('port'), '0.0.0.0', function() {
  console.log('Express server listening on port ' + app.get('port'));
});
