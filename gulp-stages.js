var fs = require('fs');

var TreeBuilder = require('./lib/tree-builder');
var types = require('./gulp-types.js');

var EjsFabricator = require('./lib/ejs-fabricator');
var TraceFilter = require('./lib/trace-filter');
var TraceTree = require('./lib/trace-tree');
var TracePrettyPrint = require('./lib/trace-pretty-print');

function writeFile(output, data, cb) {
  if (typeof data !== types.string)
    stringData = JSON.stringify(data);
  else
    stringData = data;
  fs.writeFile(output, stringData, function(err) {
    if (err)
      throw err;
    console.log('written results into \"' + output + '\".');
    // passthrough data
    cb(data);
  });
}

function readJSONFile(filename, cb) {
  console.log('reading', filename, 'as JSON');
  fs.readFile(filename, 'utf8', function(err, data) {
    if (err)
      throw err;
    var data = JSON.parse(data);
    cb(data);
  });
}

function readFile(filename, cb) {
  console.log('reading', filename, 'as string');
  fs.readFile(filename, 'utf8', function(err, data) {
    if (err)
      throw err;
    cb(data);
  });
}

/*
 * Pipeline Stages
 *
 * Each stage has an implementation function, 'impl'.
 * This function accepts a data object and a callback, and is responsible for
 * calling the callback with the result of processing the data.
 *
 * Each stage also provides a human-readable 'name',
 * an 'input' type, and an 'output' type.
 */

module.exports.JSONReader = function(filename) {
  return {
    impl: function(_, cb) { readJSONFile(filename, cb); },
    name: 'JSONReader: ' + filename,
    input: types.unit,
    output: types.JSON
  };
}

module.exports.fileToJSON = function() {
  return {
    impl: readJSONFile,
    name: 'fileToJSON',
    input: types.string,
    output: types.JSON
  };
}

module.exports.fileReader = function(filename) {
  return {
    impl: function(_, cb) { readFile(filename, cb); },
    name: 'fileReader: ' + filename,
    input: types.unit,
    output: types.string
  };
}

module.exports.fileToString = function() {
  return {
    impl: readFile,
    name: 'fileToString',
    input: types.string,
    output: types.string
  };
}

module.exports.filter = function(FilterType) {
  return {
    impl: treeBuilder(FilterType),
    name: 'filter: ' + FilterType.name,
    input: types.JSON,
    output: types.JSON,
  };
}

module.exports.fabricator = function(FabType, input) {
  input = input || types.JSON;
  return {
    impl: function(data, cb) {
      var fab = new FabType(data);
      cb(fab.fabricate());
    },
    name: 'fabricator: ' + FabType,
    input: input,
    output: types.JSON
  };
}

module.exports.ejsFabricator = function(prefix) {
  return {
    impl: function(data, cb) {
      cb(new EjsFabricator(data, prefix).fabricate());
    },
    name: 'ejsFabrictor',
    input: types.string,
    output: types.List(types.Tuple(types.string, types.string))
  }
}

module.exports.traceFilter = function() {
  return {
    impl: function(data, cb) {
      cb(new TraceFilter(data).filter());
    },
    name: 'traceFilter',
    input: types.JSON,
    output: types.JSON
  }
}

module.exports.traceTree = function() {
  return {
    impl: function(data, cb) {
      cb(new TraceTree(data).filter());
    },
    name: 'traceTree',
    input: types.JSON,
    output: types.JSON
  }
}

module.exports.tracePrettyPrint = function() {
  return {
    impl: function(data, cb) {
      cb(new TracePrettyPrint(data).filter());
    },
    name: 'tracePrettyPrint',
    input: types.JSON,
    output: types.string
  }
}

var treeBuilder = function(WriterType) {
  return function(data, cb) {
    var writer = new WriterType();
    var builder = new TreeBuilder();
    builder.build(data);
    builder.write(writer);
    cb(writer.getHTML());
  };
};

module.exports.treeBuilderWriter = function(WriterType) {
  return {
    impl: treeBuilder(WriterType),
    name: 'treeBuilderWriter: ' + WriterType.name,
    input: types.JSON,
    output: types.string
  };
}

module.exports.fileOutput = function(filename) {
  var typeVar = types.newTypeVar();
  return {
    impl: function(data, cb) { writeFile(filename, data, cb); },
    name: 'fileOutput: ' + filename,
    input: typeVar,
    output: typeVar
  };
}

module.exports.toFile = function() {
  var typeVar = types.newTypeVar();
  return {
    impl: function(data, cb) { writeFile(data.right, data.left, cb); },
    name: 'toFile',
    input: types.Tuple(typeVar, types.string),
    output: typeVar
  };
}

module.exports.consoleOutput = function() {
  var typeVar = types.newTypeVar();
  return {
    impl: function(data, cb) { console.log(data); cb(data); },
    name: 'consoleOutput',
    input: typeVar,
    output: typeVar
  };
}

module.exports.taggedConsoleOutput = function() {
  var typeVar = types.newTypeVar();
  return {
    impl: function(data, cb) { console.log(data.right); console.log('----------------'), console.log(data.left); cb(data); },
    name: 'taggedConsoleOutput',
    input: types.Tuple(typeVar, types.string),
    output: types.Tuple(typeVar, types.string)
  };
}
