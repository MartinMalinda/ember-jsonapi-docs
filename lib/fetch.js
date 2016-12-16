'use strict'

let S3 = require('s3')
let RSVP = require('rsvp')
let path = require('path')
let fs = require('fs')
let getNewDocsToIndex = require('./identify-docs-to-index')

function mkdirp (dir) {
  return new RSVP.Promise(function (resolve, reject) {
    return require('mkdirp')(dir, {}, function (err, made) {
      if (err) return reject(err)
      resolve(made)
    })
  })
}

// These are read-only credentials to the builds.emberjs.com bucket only.
var AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
var AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY

var options = {
  s3Params: {
    Bucket: 'builds.emberjs.com',
    Prefix: 'tags'
  }
}

var client = S3.createClient({
  s3Options: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  }
})

function getObjects () {
  return new RSVP.Promise(function (resolve, reject) {
    var data = []

    client.listObjects(options).on('data', function (d) {
      data = data.concat(d.Contents)
    }).on('end', function () {
      resolve(data)
    }).on('error', reject)
  })
}

function downloadReleaseDocs (data) {
  var objects = data.filter(filterReleaseDocs)
  return RSVP.map(objects, downloadFile)
}

function downloadFile (document) {
  var name = path.basename(document.Key)
  var dir = path.basename(path.dirname(document.Key))

  var finalFile = path.join('tmp', dir, name)

  return mkdirp(path.dirname(finalFile)).then(function () {
    return new RSVP.Promise(function (resolve, reject) {
      if (fs.existsSync(finalFile)) {
        return resolve(finalFile)
      } else {
        client.downloadFile({
          localFile: finalFile,
          s3Params: {
            Bucket: 'builds.emberjs.com',
            Key: document.Key
          }
        })
          .on('end', function () {
            resolve(finalFile)
          })
          .on('error', function (err) {
            console.warn('err! ' + err)
            reject(err)
          })
      }
    })
  })
}

function filterReleaseDocs (document) {
  var key = document.Key.split('/')
  var tag = key[key.length - 2]
  var versionRegex = /v\d+\.\d+\.\d+$/
  return versionRegex.test(tag) && /-docs\.json/.test(key)
}

module.exports = function fetch (db, releaseToGenDocFor) {
  return getObjects().then(docs => {
    let filteredDocs = docs.filter(doc => doc.Key.indexOf(releaseToGenDocFor) !== -1)
    return getNewDocsToIndex(db, filteredDocs)
  }).then(downloadReleaseDocs)
}
