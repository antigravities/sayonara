// Settings

var threads = 8; // Number of separate processes to use when scraping. Keep this low, but more than 1.

var rearchiveUsers = false;

// Requires

var request = require("request");
var cheerio = require("cheerio");
var fs = require("fs");
var blessed = require("blessed");
var moment = require("moment");

// Error reporting
var errors = [];

// Item cache
var itemCache = {};

// Data structures

function User(name, uid, status, completed, unique, failed, steamid, regDate, comment, commentWhen){
  this.name = name;
  this.uid = uid;
  this.status = status;
  this.completed = completed;
  this.unique = unique;
  this.failed = failed;
  this.steamid = steamid;
  this.regDate = regDate;
  this.comment = comment;
  this.commentWhen = commentWhen;
  this.offers = [];
}

function Item(id, name){
  this.name = name;
  fs.writeFile("items/" + id + ".json", JSON.stringify(this));
}

function Trade(id, from, to, items_offered_number, items_offered, items_for_number, items_for, status, timeUpdated, comments){
  this.from = from;
  this.to = to;
  this.items_offered_number = items_offered_number;
  this.items_offered = items_offered;
  this.items_for_number = items_for_number;
  this.items_for = items_for;
  this.status = status;
  this.timeUpdated = timeUpdated;
  this.comments = comments;

  fs.writeFile("offers/" + id + ".json", JSON.stringify(this));
}

function Comment(from, message, when){
  this.from = from;
  this.message = message;
  this.when = when;
}

function Cexc(thread, offendingItem, exc){
  this.thread = thread;
  this.offendingItem = offendingItem;
  this.message = exc.message;
  this.stack = exc.stack;

  errors.push(this);

  fs.writeFile("errors.json", JSON.stringify(errors));
}

// Utility functions

function getUserFromURL(url){
  return url.split("/")[4];
}

// Scrapers

function getAllUsers(callback){
  s("Requesting user list");

  request("https://barter.vg/u/", function(e,r,b){
    if( e ){
      s("Error requesting user list. Aborting");
      s(e);
      return;
    }

    var users = [];
    var skips = 0;

    s("Enumerating users");

    var $ = cheerio.load(b);

    $("th").each(function(i, e){
      if( i < 3 ) return;

      var user = $(this).children().first();

      // Skip uninitialized users
      if( user.text() == "[ name missing ]" ){
        skips+=1;
        return;
      }

      users.push(getUserFromURL(user.attr("href")));
    });

    s("Writing files");

    fs.writeFile("users/index.json", JSON.stringify(users));

    callback(users, skips);
  });
}

function scrapeUser(thread, user, callback){
  t(thread, "[" + user + "] Obtaining profile");

  if( ! rearchiveUsers && fs.existsSync("users/" + user + ".json") ) return callback(null);

  request("https://barter.vg/u/" + user, function(e,r,b){
    if( e ){
      t(thread, "[" + user + "] Hit an error. Pressing on!");
      return callback();
    }

    t(thread, "[" + user + "] Scraping profile...");

    var usera;

    try {
      var $ = cheerio.load(b);

      var comment = $($($("form[action='?']")[0]).children()[0]);

      var cUpdated = new Date();

      if( comment.html().length > 400 ){
        comment = "";
      } else {
        var dateString = $(comment.children("span")[0]).text()
        cUpdated = moment().subtract(parseInt(dateString.split(" ")[0]), dateString.split(" ")[1]).toDate()
        comment.children("span, strong").each(function(){
          $(this).remove();
        });
        comment = comment.text().trim();
      }

      usera = new User($($("h1")[0]).text(), user, $($("strong")[1]).text(), parseInt($($("strong")[2]).text()), parseInt($($("strong")[3]).text()),
        parseInt($($("strong")[4]).text()), $($($(".icon")[0]).parent()).attr("href").split("/")[4], new Date($($($("li")[5]).children()[0]).attr("title").split("on")[1]),
        comment, cUpdated);
    } catch(e){
      new Cexc(thread, "scrapeUser (inside) " + user, e);
      return callback(null);
    }

    t(thread, "[" + user + "] Scraping trades...");

    request.post("https://barter.vg/u/" + user + "/o/", {form: { filter_by_status: "all" } }, function(e,r,b){
      if( e ) {
        t(thread, "[" + user + "] Hit an error. Pressing on!");
        return callback();
      }

      var offers = [];

      try {
        var $ = cheerio.load(b);
        $("tr").each(function(i){
          if( i == 0 ) return;

          var elem = $(this);

          if( $(this).children().length <= 1 ) return;

          offers.push($($(this).children().first().children()[1]).attr("href").split("/")[6]);
        });
      } catch(e){
        new Cexc(thread, "scrapeTrades (inside) " + user, exc);
        return callback();
      }

      usera.offers = offers;

      fs.writeFile("users/" + user + ".json", JSON.stringify(usera));

      callback(offers);
    });

  });
}

function scrapeTrade(thread, user, trade, callback){
  t(thread, "[" + user + "/" + trade + "] Getting offer");

  if( fs.existsSync("offers/" + trade + ".json") ){
    return callback();
  }

  request("https://barter.vg/u/" + user + "/o/" + trade + "/", function(e,r,b){
    if( e ){
      t(thread, "[" + user + "/" + trade + "] Hit an error. Pressing on!");
      return callback();
    }

    try {
      var $ = cheerio.load(b);

      var nOffered, nFor;

      if( $(".midsized").length < 1 ){
        nOffered = 1;
        nFor = 1;
      } else {
        nOffered = parseInt($($(".midsized")[0]).text());
        nFor = parseInt($($(".midsized")[2]).text());
      }

      if( nOffered == null ) nOffered = 1;
      if( nFor == null ) nFor = 1;

      var comments = [];

      if( !!$("#offerMessages").length ){
        $("#offerMessages").children().each(function(){
          if($($(this).children("abbr")[0]).attr("style") == "color:#777;") return;
          var uid = $(this.children[0]).attr("href").split("/")[4];
          var time = new Date($($(this).children("time")[0]).attr("datetime"));
          $($(this).children("time")[0]).remove();
          var comment = $(this).text().trim();
          comments.push(new Comment(uid, comment, time));
        });
      }

      var items = [];

      $(".tradables_items_list").each(function(i){
        items[i] = [];

        $(this).children().each(function(){

            var item = $(this);
            if( item.attr("class") != null ) return;
            var id = "";

            try {
              if( $($(item.children()[1]).children().first()).attr("href") != null ){
                id=$($(item.children()[1]).children().first()).attr("href").split("/")[4];
              }
              else {
                id=$(item.children()[1]).attr("href").split("/")[4];
              }

              if( ! itemCache.hasOwnProperty(id) ){
                new Item(id, $(item).text().split("↗")[0].trim());
                itemCache[id] = true;
              }

              items[i].push(id);
            } catch(e){
              new Cexc(thread, "scrapeTrade (inside) " + trade, e);
              return callback();
            }
        });
      });

      var uid0 = "";
      var uid1 = "";

      if( $("td")[0].children[0].children[0].name != "a" ){
        uid0 = $($($($("td")[0]).children()[1]).children()[0]).attr("href").split("/")[4];
      } else {
        uid0 = $($($($("td")[0]).children()[0]).children()[0]).attr("href").split("/")[4];
      }

      if( $("td")[2].children[0].children[0].name != "a" ){
        uid1 = $($($($("td")[2]).children()[1]).children()[0]).attr("href").split("/")[4];
      } else {
        uid1 = $($($($("td")[2]).children()[0]).children()[0]).attr("href").split("/")[4];
      }

      new Trade(
        trade,
        uid0,
        uid1,
        nOffered,
        items[0],
        nFor,
        items[1],
        $($(".statusCurrent")[0]).text(),
        new Date($($("time")[0]).attr("datetime")),
        comments
      );
    } catch(e){
      new Cexc(thread, "scrapeTrade (inside) " + user + "/" + trade, e);
    }

    callback();
  });
}

// Init

if( ! fs.existsSync("users") ) fs.mkdirSync("users");
if( ! fs.existsSync("offers") ) fs.mkdirSync("offers");
if( ! fs.existsSync("items") ) fs.mkdirSync("items");

// GUI

function s(status){
  output.setContent("{bold}" + screen.title + "{/bold}\n\n" + status);
  screen.render();
}

var threadstatus = [];

function t(thread, status){
  threadstatus[thread] = status;
  var content = "{bold}" + screen.title + "{/bold}\n" + threadstatus[threads] + "\n";

  for( var i=0; i<threadstatus.length; i++ ){
    content += "{blue-bg}Thread " + i + "{/blue-bg}: " + threadstatus[i] +"\n";
  }

  content += "\nPress Ctrl+C at any time to cancel";

  output.setContent(content)
  screen.render();
}

var screen = blessed.screen({
  smartCSR: true
});

screen.title = "Sayonara Barter 0.1.0";

var output = blessed.box({
  top: 'center', left: 'center', width: '99%', height: '99%', content: '{bold}' + screen.title + '{/bold}',
  tags: true, border: { type: 'line' }, style: { fg: 'white', bg: 'magenta' }, scrollable: true
});

screen.append(output);

screen.render();

// Application code

setTimeout(function(){
  getAllUsers(function(users, skips){
    var queued = users;
    function queue(thread){
      if( queued.length < 1 ) return t(thread, "Oops! Nothing left to do...");
      var user = queued.shift();
      t(thread, "Selected user " + user);

      scrapeUser(thread, user, function(offers){

        if( offers == null ) return queue(thread);

        var queuedOffers = offers;

        function qo(){
          if( queuedOffers.length == 0 ){
            return queue(thread);
          }

          var currOffer = queuedOffers.shift();

          scrapeTrade(thread, user, currOffer, qo);
        }

        qo();
      });
    }

    function startThread(thread){
      setTimeout(function(){ queue(thread); }, 0);
    }

    for( var i=0; i<threads; i++ ){
      startThread(i);
    }
  });
}, 0);
