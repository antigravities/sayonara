// Number of simultaneous scraping processes.
// Please be considerate
var threads = 2;

var Cheerio = require("cheerio");
var request = require("request");
var blessed = require("blessed");

var fs = require("fs");

var threadstatus = [];

var screen = blessed.screen({
  smartCSR: true
});

screen.title = "Sayonara Barter 0.1.0";

var output = blessed.box({
  top: 'center', left: 'center', width: '99%', height: '99%', content: 'Please wait...',
  tags: true, border: { type: 'line' }, style: { fg: 'white', bg: 'magenta' }, scrollable: true
});

screen.append(output);

var users = [];

var userAs = {};
var trades = {};
var itemsG = {};

var errors = [];

var skips = 0;

function User(name, uid, status, completed, unique, failed, steamid){
  this.name = name;
  this.uid = uid;
  this.status = status;
  this.completed = completed;
  this.unique = unique;
  this.failed = failed;
  this.steamid = steamid;
  this.trades = [];
}

function Item(name){
  this.name = name;
}

function Trade(from, to, items_offered_number, items_offered, items_for_number, items_for, status){
  this.from = from;
  this.to = to;
  this.items_offered_number = items_offered_number;
  this.items_offered = items_offered;
  this.items_for_number = items_for_number;
  this.items_for = items_for;
  this.status = status;
}

function Cexc(thread, offendingItem, exc){
  this.thread = thread;
  this.offendingItem = offendingItem;
  this.message = exc.message;
  this.stack = exc.stack;

  errors.push(this);
}

function getUserFromURL(url){
  return url.split("/")[4];
}

function s(status){
  output.setContent("{bold}" + screen.title + "{/bold}\n\n" + status);
  screen.render();
}

function pauseOnMessage(msg){
  console.log(msg);
  while(true){}
}

function t(thread, status){
  threadstatus[thread] = status;
  var content = "{bold}" + screen.title + "{/bold}\n" + threadstatus[threads] + "\n";

  for( var i=0; i<threadstatus.length; i++ ){
    content += "{blue-bg}Thread " + i + "{/blue-bg}: " + threadstatus[i] +"\n";
  }

  content += "\n" + users.length + " users left in queue. Press Ctrl+C at any time to cancel";

  output.setContent(content)
  screen.render();
}

function queue(thread){
  if(users.length == 0) return t(thread, "No users in queue, nothing to do...");
  var user = users.shift();
  t(thread, "Preparing to scrape " + user);

  try {
    scrapeUser(thread, user, function(){
      try {
        scrapeTrades(thread, user, function(){
          setTimeout(function(){ queue(thread) }, 1);
        });
      } catch(e){
        new Cexc(thread, "scrapeTrades" + user, e);
      }
    });
  } catch(e){
    new Cexc(thread, "scrapeUser " + user, e);
    return queue(thread);
  }
}

function scrapeUser(thread, user, callback){
  t(thread, "[" + user + "] Obtaining profile");

  request("https://barter.vg/u/" + user, function(e,r,b){
    if( e ){
      t(thread, "[" + user + "] Hit an error. Pressing on!");
      return callback();
    }

    t(thread, "[" + user + "] Scraping profile...");

    try {
      var $ = Cheerio.load(b);
      var usera = new User($($("h1")[0]).text(), user, $($("strong")[1]).text(), parseInt($($("strong")[2]).text()), parseInt($($("strong")[3]).text()),
        parseInt($($("strong")[4]).text()), $($($(".icon")[0]).parent()).attr("href").split("/")[4]);
    } catch(e){
      new Cexc(thread, "scrapeUser (inside) " + user, exc);
      return callback();
    }

    userAs[user] = usera;
    callback();
  });
}

function scrapeTrades(thread, user, callback){
  t(thread, "[" + user + "] Obtaining trade list");

  request.post("https://barter.vg/u/" + user + "/o/", {form: { filter_by_status: "all" } }, function(e,r,b){
    if( e ) {
      t(thread, "[" + user + "] Hit an error. Pressing on!");
      return callback();
    }

    var offers = [];

    try {
      var $ = Cheerio.load(b);
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

    userAs[user].trades = offers;

    if( offers.length == 0 ) return callback();

    var i = 1;

    function handle(){
      i++;
      if( i < offers.length ){
        if( trades.hasOwnProperty(offers[i]) ) return handle();
        scrapeTrade(thread, user, offers[i], handle);
      } else {
        callback();
      }
    }

    scrapeTrade(thread, user, offers[0], handle);
  });
}

function scrapeTrade(thread, user, trade, callback){
  t(thread, "[" + user + "/" + trade + "] Getting offer");

  request("https://barter.vg/u/" + user + "/o/" + trade + "/", function(e,r,b){
    if( e ){
      t(thread, "[" + user + "/" + trade + "] Hit an error. Pressing on!");
      return callback();
    }

    try {
      var $ = Cheerio.load(b);

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

            itemsG[parseInt(id)] = new Item($(item).text().split("↗")[0].trim());
            items[i].push(parseInt(id));
          } catch(e){
            console.log(e);
            return;
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

      trades[trade] = new Trade(
        uid0,
        uid1,
        nOffered,
        items[0],
        nFor,
        items[1],
        $($(".statusCurrent")[0]).text()
      );
    } catch(e){
      new Cexc(thread, "scrapeTrade (inside) " + user + "/" + trade, e);
    }

    callback();
  });
}

s("Requesting user list");

request("https://barter.vg/u/", function(e,r,b){
  if( e ){
    s("Error requesting user list. Aborting");
    s(e);
    return;
  }

  s("Enumerating users");

  var $ = Cheerio.load(b);

  $("th").each(function(i, e){
    if( i < 3 ) return;

    var user = $(this).children().first();

    if( user.text() == "[ name missing ]" ){
      skips+=1;
      return;
    }

    users.push(getUserFromURL(user.attr("href")));
  });

  s("I will scrape " + users.length + " users (" + skips + " skipped) using " + threads + " threads in 10 seconds. Press Ctrl-C to cancel.");

  setTimeout(function(){
    s("Beginning scrape.");

    for( var i=0; i<threads; i++ ){
      prepTimeout(i);
    }

    t(threads, "No errors.");
  }, 1);

  setInterval(function(){
    fs.writeFileSync("users.json", JSON.stringify(userAs));
    fs.writeFileSync("trades.json", JSON.stringify(trades));
    fs.writeFileSync("items.json", JSON.stringify(itemsG));
    fs.writeFileSync("errors.json", JSON.stringify(errors));
  }, 10000);

});

function prepTimeout(i){
  setTimeout(function(){
    queue(i);
  }, i);
}

process.on("uncaughtException", function(exc){
  t(threads, "Uncaught exception: " + exc);
});
