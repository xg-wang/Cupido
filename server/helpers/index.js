const fs = require('fs');
const _ = require('lodash');
const ConversationV1 = require('watson-developer-cloud/conversation/v1');
const ToneAnalyzerV3 = require('watson-developer-cloud/tone-analyzer/v3');
const PersonalityInsightsV3 = require('watson-developer-cloud/personality-insights/v3');
const Cloudant = require('@cloudant/cloudant');

module.exports = {
  initServices,
  updateDoc,
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

function updateDoc(db, text, username, interestsSet, id) {
  return new Promise((resolve, reject) => {
    db.get(id, function(error, existing) {
      let newDoc = {
        texts: [{ text, time: new Date().toString() }],
        username: username,
        interests: []
      };
      if (!error) {
        newDoc = _.cloneDeep(existing);
        newDoc.username = username;
        newDoc.texts = [...newDoc.texts, { text, time: new Date().toString() }];
        for (let i of newDoc.interests) {
          interestsSet.add(i);
        }
        newDoc.interests = Array.from(interestsSet);
      }
      db.insert(newDoc, id, err => {
        if (err) reject('update fail');
        else resolve('update success');
      });
    });
  });
}

function getPersonalityInsights(db, id, personalityInsights) {
  return new Promise((resolve, reject) => {
    db.get(id, function(error, doc) {
      if (error) {
        resolve("Not enough data, let's talk more! What do you like to do?");
      }
      const contentItems = doc.texts.map((text, idx) => ({
        id: `${id}-${idx}`,
        language: 'en', // TODO: use input.language
        contenttype: 'text/plain',
        content: text.text,
        created: Date.parse(text.time),
        reply: true
      }));
      personalityInsights.profile(
        {
          contentItems,
          consumption_preferences: true
        },
        function(error, response) {
          if (error) {
            console.log('Error:', error);
            // if error, we don't have enough data, fall back to naive way.
            naiveMatch(db, id, doc.interests).then(msg => resolve(msg));
          } else {
            // console.log(JSON.stringify(response, null, 2));
            updateInsightsToInterests(db, id, response).then(newInterests => {
              naiveMatch(db, id, newInterests).then(msg => resolve(msg));
            });
          }
        }
      );
    });
  });
}

// select most matched interests username
function naiveMatch(db, id, interests) {
  return new Promise((res, rej) => {
    let maxDoc,
      maxCount = 0;
    db.list({ include_docs: true }, (err, body) => {
      if (!err) {
        body.rows.forEach(doc => {
          if (doc.id === id) return;
          const common = _.intersection(doc.doc.interests, interests);
          if (common.length >= maxCount) {
            maxDoc = doc;
            maxCount = common.length;
          }
        });
        const common = _.intersection(maxDoc.doc.interests, interests);
        const str = common.join(', ');
        res(
          `${
            maxDoc.doc.username
          } is your best match! Your common interests are ${str}`
        );
      } else {
        rej(err);
      }
    });
  });
}

function updateInsightsToInterests(db, id, response) {
  return new Promise((resolve, reject) => {
    db.get(id, function(error, existing) {
      if (!error) {
        newDoc = _.cloneDeep(existing);
        const personalityArr = (response.personality || [])
          .filter(r => r.percentile >= 0.75)
          .map(r => r.name);
        const needsArr = (response.needs || [])
          .filter(r => r.percentile >= 0.75)
          .map(r => r.name);
        const valuesArr = (response.values || [])
          .filter(r => r.percentile >= 0.75)
          .map(r => r.name);
        newDoc.interests.push(...personalityArr, ...needsArr, ...valuesArr);
        db.insert(newDoc, id, err => {
          if (!err) resolve(newDoc.interests);
          else reject('insert fail');
        });
      }
    });
  });
}
