# Server Status Scoreboard

A tool we use to fetch server status, including CPU usage, disk usage and a rough indication of web traffic for many sites. It is meant to be used on a permanently mounted scoreboard monitor. It is also interesting to look at on other displays.

This is NOT an uptime monitor per se. We feel you should use something EXTERNAL to your company, such as aremysitesup.com or a similar site, for basic uptime monitoring reality checks.

## Usage

Copy config-example.js to config.js and edit it. Set the reporting URL to the host where you'll be running scoreboard.js. Set a unique API key of your very own.

On webservers, run...

    node reporter.js

reporter.js analyzes logs in /var/log/nginx. If that folder does not exist it looks at /var/log/apache2. We always use nginx as a reverse proxy to node apps and on mixed node/apache boxes, so this setup works well for us.

On the host where you'd like to display reports, run...

    node scoreboard.js

Then access:

    http://yourscoreboardmachine:30000/?apikey=yourapikey

The api key will then disappear from the URL.

You may run both on a server if it happens to host websites in addition to the scoreboard, which is perfectly fine to do.

You will see zeroes for each site until the first interval ends (5 minutes, in our configuration).

This is a work in progress.

## To Develop Locally

Got an instance of the scoreboard running in production? Great, just slave your local dev copy to it as a data source. Set the `dataSource` option like this in `config.js` for your local copy:

    dataSource: 'http://my-scoreboard-site.com:30000/data?apikey=my-api-key'

If not, here's an alternative:

Make some empty files in /var/log/nginx, like /var/log/nginx/test1.log, /var/log/nginx/test2.log, etc. Run reporter. In a separate terminal tab, run scoreboard. Now you have something to look at while tweaking the source code.

