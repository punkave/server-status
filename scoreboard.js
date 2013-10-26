var config = require('./config.js');
var express = require('express');
var nunjucks = require('nunjucks');
var request = require('request');
var extend = require('extend');
var fs = require('fs');
var _ = require('lodash');

var app = express();
app.use(express.static(__dirname + '/public'));
app.use(express.bodyParser());
app.use(express.cookieParser());
var env = new nunjucks.Environment(new nunjucks.FileSystemLoader('views'));
env.addFilter('json', function(data) {
  return JSON.stringify(data);
});
env.express(app);

var port = config.port || 30000;
var apikey = config.apikey;
// Default to 5min
var interval = config.interval || (5 * 60000);
// Keeping 144 epochs = 12 hours at 5min per epoch
var keep = config.keep || 144;
// Slave this scoreboard to another rather than receiving reports
var dataSource = config.dataSource;

var snapshotFile = __dirname + '/snapshot.json';

var timeline = [];
var scoreboard = {};

// Fields that live on the scoreboard server and should not be overwritten
// by reports

var preserve = [ 'trash' ];

if (fs.existsSync(snapshotFile)) {
  parseTimeline(fs.readFileSync(snapshotFile));
}

// API for submitting a report from a server
app.post('/report', function(req, res) {
  if (req.body.apikey !== apikey) {
    res.statusCode = 404;
    return res.send('notfound');
  }
  _.each(req.body.sites, function(site) {
    var preserved;
    if (scoreboard[site.name]) {
      preserved = _.pick(scoreboard[site.name], preserve);
    }
    site.previous = scoreboard[site.name];
    if (site.previous) {
      delete site.previous.previous;
    }
    site.ip = req.ip;
    site.when = new Date();
    site.disk = req.body.disk;
    site.cpu = req.body.cpu;
    if (preserved) {
      extend(true, site, preserved);
    }
    scoreboard[site.name] = site;
  });
  return res.send('ok');
});

app.get('/trash', function(req, res) {
  var name = req.query.name;
  var site = scoreboard[name];
  if (site) {
    site.trash = !site.trash;
  }
  return res.redirect('/');
});

// API for data access
app.get('/data', function(req, res) {
  if (req.query.apikey !== apikey) {
    res.statusCode = 404;
    return res.send('notfound');
  }
  return res.send(JSON.stringify(timeline));
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
  sites = _.filter(sites, function(site) {
    // Yes, ==
    return site.trash == req.query.trash;
  });
  if (req.query.ip) {
    sites = _.filter(sites, function(site) {
      return site.ip === req.query.ip;
    });
  }
  // If we are slaved to a data source let the source decide if the site is late
  if (!dataSource) {
    var now = new Date();
    _.each(sites, function(site) {
      // If we haven't heard from the site in 3 intervals, it's time to be concerned
      site.late = ((now.getTime() - site.when.getTime()) / interval) > 3;
    });
  }
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
    } else if (a.name > b.name) {
      return 1;
    } else {
      return 0;
    }
  });
  _.each(sites, function(site) {
    site.history = [];
    _.each(timeline, function(scoreboard) {
      if (scoreboard[site.name]) {
        site.history.push(_.pick(scoreboard[site.name], [ 'pages', 'errors', 'late' ]));
      } else {
        site.history.push({});
      }
    });
    site.history.push(site.pages);
  });
  return res.render('scoreboard.html', { sites: sites, trash: req.query.trash, ip: req.query.ip });
});

app.get('/details', function(req, res) {
  var name = req.query.name;
  var site = scoreboard[name];
  if (!site) {
    res.statusCode = 404;
    return res.send('notfound');
  }
  return res.render('details.html', site);
});

app.get('/logout', function(req, res) {
  res.clearCookie('apikey');
  res.statusCode = 200;
  return res.send('logged out');
});

// Save a JSON snapshot of what we know once per interval
// so we can easily restart. Also rotates the timeline
setInterval(snapshot, interval);

if (dataSource) {
  // We are slaved to another scoreboard, fetch data from it
  setInterval(fetch, 30000);
  fetch();
}

console.log('Listening on port ' + port);
app.listen(port);

function snapshot() {
  if (!dataSource) {
    var oldScoreboard = {};
    extend(true, oldScoreboard, scoreboard);
    delete oldScoreboard.history;
    delete oldScoreboard.previous;
    timeline.push(oldScoreboard);
    if (timeline.length > keep) {
      timeline.shift();
    }
  }
  fs.writeFileSync(__dirname + '/snapshot.json', JSON.stringify(timeline));
}

function fetch() {
  request({
    method: 'GET',
    uri: dataSource
  }, function(err, response, body) {
    if (err) {
      console.error(err);
      // TODO: get the admin's attention in some other way if we cannot talk to the scoreboard server for
      // a long time
    } else {
      parseTimeline(body);
    }
  });
}

function parseTimeline(json) {
  timeline = JSON.parse(json, function(k, v) {
    // Reviver to deal with date strings and turn them back into dates. JSON
    // makes me pine for PHP's serialize... OK just a little
    if (k === 'when') {
      return new Date(v);
    }
    return v;
  });
  if (!Array.isArray(timeline)) {
    // It's an old-style snapshot with just one scoreboard in it
    timeline = [ timeline ];
  }
  if (timeline.length) {
    scoreboard = _.last(timeline);
  } else {
    scoreboard = {};
  }
}
