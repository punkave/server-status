var config = require('./config.js');
var express = require('express');
var nunjucks = require('nunjucks');
var _ = require('lodash');

var app = express();
app.use(express.static(__dirname + '/public'));
app.use(express.bodyParser());
app.use(express.cookieParser());
var env = new nunjucks.Environment(new nunjucks.FileSystemLoader('views'));
env.express(app);

var port = config.port || 30000;
var apikey = config.apikey;
var scoreboard = {};

app.post('/report', function(req, res) {
  if (req.body.apikey !== apikey) {
    res.statusCode = 404;
    return res.send('notfound');
  }
  _.each(req.body.sites, function(site) {
    site.disk = req.body.disk;
    site.cpu = req.body.cpu;
    scoreboard[site.name] = site;
  });
  return res.send('ok');
});

app.get('/', function(req, res) {
  if (req.query.apikey === apikey) {
    res.cookie('apikey', req.query.apikey);
    return res.redirect('/');
  }
  if (req.cookies.apikey !== apikey) {
    res.statusCode = 404;
    return res.send('notfound');
  }
  var sites = _.values(scoreboard);
  sites.sort(function(a, b) {
    if (a.pages > b.pages) {
      return 1;
    } else if (a.pages < b.pages) {
      return -1;
    } else {
      return 0;
    }
  });
  return res.render('scoreboard.html', { sites: sites });
});

app.get('/logout', function(req, res) {
  res.clearCookie('apikey');
  res.statusCode = 200;
  return res.send('logged out');
});

console.log('Listening on port ' + port);
app.listen(port);

