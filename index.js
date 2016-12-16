'use strict'

let RSVP = require('rsvp')
let _ = require('lodash')
let rm = require('rimraf')
let PouchDB = require('pouchdb')
let fs = require('fs')
let glob = require('glob')

let fetch = require('./lib/fetch')
let readDocs = require('./lib/read-docs')
let addSinceTags = require('./lib/add-since-tags')
let addInheritedItems = require('./lib/add-inherited-items')
let putClassesInCouch = require('./lib/classes-in-couch')
let createVersionIndex = require('./lib/create-version-index')
let normalizeEmberDependencies = require('./lib/normalize-ember-dependencies')
let normalizeIDs = require('./lib/normalize-ids')
let markup = require('./lib/markup')
let batchUpdate = require('./lib/batch-update')

require('marked')

let db = new PouchDB(process.env.COUCH_URL, {
  auth: {
    username: process.env.COUCH_USERNAME,
    password: process.env.COUCH_PASSWORD
  }
})

if (fs.existsSync('tmp/docs')) {
  rm.sync('tmp/docs')
}

async function transformProjectFiles (projectName) {
  console.log('reading docs for ' + projectName)
  let docs = await RSVP.resolve(readDocs(projectName))

  console.log('adding since tags for ' + projectName)
  let docsWithTags = await addSinceTags(docs)

  console.log('adding inherited items for ' + projectName)
  let docsWithInheritedItems = await addInheritedItems(docsWithTags)

  console.log('normalizing yuidocs for ' + projectName)
  let normalizedDocs = await normalizeIDs(docsWithInheritedItems, projectName)

  console.log('creating version index for ' + projectName)
  let docsWithVersionIndex = await createVersionIndex(db, projectName, normalizedDocs).then(() => normalizedDocs)

  console.log('converting markdown to html for ' + projectName)
  return await markup(docsWithVersionIndex)

}

let projects = ['ember', 'ember-data']
let releaseToGenDocFor = process.argv[2] ? process.argv[2] : ''

console.log('downloading docs for ' + projects.join(' & '))

fetch(db, releaseToGenDocFor).then(async (downloadedFiles) => {

  try {
    for (let i = 0; i < projects.length; i++) {
      let docs = await transformProjectFiles(projects[i])
      let giantDocument = {
        data: _.flatten(docs.map(doc => doc.data))
      }
      console.log('normalizing dependencies')
      normalizeEmberDependencies(giantDocument)
      await putClassesInCouch(giantDocument, db)

    }

    let docs = glob.sync('tmp/docs/**/*.json')
    console.log('putting document in CouchDB')
    return batchUpdate(db, docs);

  } catch (err) {
    console.warn('err!', err, err.stack)
    process.exit(1)
  }

})
