var fs = require("fs");

console.log("Compiling database...");

function compile(item){
    var items = fs.readdirSync(item);
    var itmres = {};
    console.log("Compiling " + items.length + " " + item + "...");
    items.forEach(function(v){
      var name = v.toString().split(".")[0];
      itmres[name] = JSON.parse(fs.readFileSync(item + "/" + v));
    });
    fs.writeFileSync(item + ".json", JSON.stringify(itmres));
}

compile("offers");
compile("users");
compile("items");
