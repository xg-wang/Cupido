const fs = require('fs');
const express = require('express');
const router = express.Router();
const multipartMiddleware = require('connect-multiparty')();
const Helpers = require('../helpers');
const toneDetection = require('../helpers/tone_detection.js');
/**
 * This example stores tone for each user utterance in conversation context.
 * Change this to false, if you do not want to maintain history
 */
const maintainToneHistory = true;

const {
  cloudant,
  db,
  conversation,
  toneAnalyzer,
  personalityInsights
} = Helpers.initServices();

// Endpoint to be called from the client side
router.post('/message', function(req, res) {
  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if (!workspace || workspace === '<workspace-id>') {
    return res.json({
      output: {
        text:
          'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' +
          '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>' +
          'Once a workspace has been defined the intents may be imported from ' +
          '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    });
  }
  var payload = {
    workspace_id: workspace,
    context: {},
    input: {}
  };

  if (req.body) {
    if (req.body.input) {
      payload.input = req.body.input;
    }
    if (req.body.context) {
      payload.context = req.body.context;
    }

    // Invoke the tone-aware call to the Conversation Service
    invokeToneConversation(payload, res);
  }
});

/**
 * Updates the response text using the intent confidence
 *
 * @param {Object}
 *                input The request to the Conversation service
 * @param {Object}
 *                response The response from the Conversation service
 * @return {Object} The response with the updated message
 */
function updateMessage(input, response) {
  var responseText = null;

  if (!response.output) {
    response.output = {
      text: ''
    };
  } else if (response.output.end) {
    return Helpers.getPersonalityInsights(
      db,
      response.context.conversation_id
    ).then(personalityInsightsResult => {
      response.output.text = [personalityInsightsResult];
      return response;
    });
  } else if (response.context.username) {
    Helpers.updateDocTexts(
      db,
      input.input.text,
      response.context.username,
      response.context.conversation_id
    );
  }

  return Promise.resolve(response);
}

/**
 * invokeToneConversation calls the invokeToneAsync function to get the tone information for the user's
 * input text (input.text in the payload json object), adds/updates the user's tone in the payload's context,
 * and sends the payload to the conversation service to get a response which is printed to screen.
 * @param payload a json object containing the basic information needed to converse with the Conversation Service's
 * message endpoint.
 *
 * Note: as indicated below, the console.log statements can be replaced with application-specific code to process
 * the err or data object returned by the Conversation Service.
 */
function invokeToneConversation(payload, res) {
  toneDetection
    .invokeToneAsync(payload, toneAnalyzer)
    .then(tone => {
      toneDetection.updateUserTone(payload, tone, maintainToneHistory);
      conversation.message(payload, function(err, data) {
        if (err) {
          console.error(JSON.stringify(err, null, 2));
          return res.status(err.code || 500).json(err);
        } else {
          updateMessage(payload, data).then(response => {
            return res.json(response);
          });
        }
      });
    })
    .catch(function(err) {
      console.log(JSON.stringify(err, null, 2));
    });
}

module.exports = router;
