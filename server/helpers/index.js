const fs = require('fs');
const ConversationV1 = require('watson-developer-cloud/conversation/v1');
const ToneAnalyzerV3 = require('watson-developer-cloud/tone-analyzer/v3');
const PersonalityInsightsV3 = require('watson-developer-cloud/personality-insights/v3');
const Cloudant = require('@cloudant/cloudant');

module.exports = {
  initServices,
  updateDocTexts,
  getPersonalityInsights
};

function initServices() {
  const dbCredentials = {
    dbName: 'my_sample_db'
  };
  // When running on Bluemix, this letiable will be set to a json object
  // containing all the service credentials of all the bound services
  // When running locally, the VCAP_SERVICES will not be set
  // When running this app locally you can get your Cloudant credentials
  // from Bluemix (VCAP_SERVICES in "cf env" output or the Environment
  // letiables section for an app in the Bluemix console dashboard).
  // Once you have the credentials, paste them into a file called vcap-local.json.
  // Alternately you could point to a local database here instead of a
  // Bluemix service.
  // url will be in this format: https://username:password@xxxxxxxxx-bluemix.cloudant.com
  const vcapServices = process.env.VCAP_SERVICES
    ? JSON.parse(process.env.VCAP_SERVICES)
    : JSON.parse(fs.readFileSync('vcap-local.json', 'utf-8'));
  dbCredentials.url = getCredentials(vcapServices, /cloudant/i);
  const cloudant = Cloudant(dbCredentials.url);
  const db = cloudant.use(dbCredentials.dbName);

  // check if DB exists if not create
  cloudant.db.create(dbCredentials.dbName, function(err, res) {
    if (err) {
      console.log(
        'Could not create new db: ' +
          dbCredentials.dbName +
          ', it might already exist.'
      );
    }
  });

  const conversationCredentials = getCredentials(vcapServices, /conversation/i);
  const conversation = new ConversationV1({
    username:
      process.env.CONVERSATION_USERNAME || conversationCredentials.username,
    password:
      process.env.CONVERSATION_PASSWORD || conversationCredentials.password,
    version_date: '2017-05-26'
  });

  const toneCredentials = getCredentials(vcapServices, /tone/i);
  var toneAnalyzer = new ToneAnalyzerV3({
    username: process.env.TONE_ANALYZER_USERNAME || toneCredentials.username,
    password: process.env.TONE_ANALYZER_PASSWORD || toneCredentials.password,
    version_date: '2017-09-21'
  });

  const personalityCredentials = getCredentials(vcapServices, /personality/i);
  const personalityInsights = new PersonalityInsightsV3({
    username:
      process.env.PERSONAL_INSIGHT_USERNAME || personalityCredentials.username,
    password:
      process.env.PERSONAL_INSIGHT_PASSWORD || personalityCredentials.password,
    version_date: '2016-10-19'
  });

  function getCredentials(jsonData, regex) {
    // Pattern match to find the first instance of a Cloudant service in
    // VCAP_SERVICES. If you know your service key, you can access the
    // service credentials directly by using the vcapServices object.
    for (let vcapService in vcapServices) {
      if (vcapService.match(regex)) {
        return vcapServices[vcapService][0].credentials;
      }
    }
  }

  return {
    cloudant,
    db,
    conversation,
    toneAnalyzer,
    personalityInsights
  };
}

function updateDocTexts(db, text, username, id) {
  db.get(id, function(error, existing) {
    const newDoc = {
      texts: [text],
      username: username
    };
    if (!error) {
      newDoc._rev = existing._rev;
      newDoc.texts = [...existing.texts, text];
    }
    db.insert(newDoc, id);
  });
}

function getPersonalityInsights(db, id) {
  return new Promise((resolve, reject) => {
    db.get(id, function(error, doc) {
      if (error) {
        resolve("Not enough data, let's talk more! What do you like to do?");
      }
      resolve('pi');
    });
  });
}
