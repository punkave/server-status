var config = require('./config.js');
var express = require('express');
var nunjucks = require('nunjucks');
var fs = require('fs');
var _ = require('lodash');

var app = express();
app.use(express.static(__dirname + '/public'));
app.use(express.bodyParser());
app.use(express.cookieParser());
var env = new nunjucks.Environment(new nunjucks.FileSystemLoader('views'));
env.express(app);

var port = config.port || 30000;
var apikey = config.apikey;
var interval = config.interval;
var scoreboard = {};

var snapshotFile = __dirname + '/snapshot.json';

if (fs.existsSync(snapshotFile)) {
  scoreboard = JSON.parse(fs.readFileSync(snapshotFile), function(k, v) {
    // Reviver to deal with date strings and turn them back into dates. JSON
    // makes me pine for PHP's serialize... OK just a little
    if (k === 'when') {
      return new Date(v);
    }
    return v;
  });
}

// API for submitting a report from a server
app.post('/report', function(req, res) {
  if (req.body.apikey !== apikey) {
    res.statusCode = 404;
    return res.send('notfound');
  }
  _.each(req.body.sites, function(site) {
    site.previous = scoreboard[site.name];
    if (site.previous) {
      delete site.previous.previous;
    }
    site.when = new Date();
    site.disk = req.body.disk;
    site.cpu = req.body.cpu;
    scoreboard[site.name] = site;
  });
  return res.send('ok');
});

// API for data access
app.get('/data', function(req, res) {
  if (req.query.apikey !== apikey) {
    res.statusCode = 404;
    return res.send('notfound');
  }
  return res.send(JSON.stringify(scoreboard));
});

// UI for end users & dedicated scoreboard monitors
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
  var now = new Date();
  _.each(sites, function(site) {
    // If we haven't heard from the site in 3 intervals, it's time to be concerned
    site.late = ((now.getTime() - site.when.getTime()) / interval) > 3;
  });
  sites.sort(function(a, b) {
    // Sort by: lateness (monitoring offline), errors, pages, name
    if (a.late && (!b.late)) {
      return -1;
    } else if (b.late && (!a.late)) {
      return 1;
    } else if (a.errors < b.errors) {
      return 1;
    } else if (a.errors > b.errors) {
      return -1;
    } else if (a.pages < b.pages) {
      return 1;
    } else if (a.pages > b.pages) {
      return -1;
    } else if (a.name < b.name) {
      return -1;
    } else if (b.name > a.name) {
      return 1;
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

// Save a JSON snapshot of what we know every 30 seconds
// so we can easily restart
setInterval(snapshot, 30000);

console.log('Listening on port ' + port);
app.listen(port);

function snapshot() {
  fs.writeFileSync(__dirname + '/snapshot.json', JSON.stringify(scoreboard));
}
