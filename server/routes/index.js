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
  } else if (response.context.end) {
    response.output.text = ['OK! Please wait for the matching...'];
  } else {
    db.insert({
      request: input,
      response: response,
      time: new Date()
    });
  }

  return response;
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
        let returnObject = null;
        if (err) {
          console.error(JSON.stringify(err, null, 2));
          returnObject = res.status(err.code || 500).json(err);
        } else {
          returnObject = res.json(updateMessage(payload, data));
        }
        return returnObject;
      });
    })
    .catch(function(err) {
      console.log(JSON.stringify(err, null, 2));
    });
}

function createResponseData(id, name, value, attachments) {
  let responseData = {
    id: id,
    name: sanitizeInput(name),
    value: sanitizeInput(value),
    attachements: []
  };

  attachments.forEach(function(item, index) {
    let attachmentData = {
      content_type: item.type,
      key: item.key,
      url: '/api/favorites/attach?id=' + id + '&key=' + item.key
    };
    responseData.attachements.push(attachmentData);
  });
  return responseData;
}

function sanitizeInput(str) {
  return String(str)
    .replace(/&(?!amp;|lt;|gt;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function saveDocument(id, name, value, response) {
  if (id === undefined) {
    // Generated random id
    id = '';
  }

  db.insert(
    {
      name: name,
      value: value
    },
    id,
    function(err, doc) {
      if (err) {
        console.log(err);
        response.sendStatus(500);
      } else response.sendStatus(200);
      response.end();
    }
  );
}

router.get('/api/favorites/attach', function(request, response) {
  let doc = request.query.id;
  let key = request.query.key;

  db.attachment.get(doc, key, function(err, body) {
    if (err) {
      response.status(500);
      response.setHeader('Content-Type', 'text/plain');
      response.write('Error: ' + err);
      response.end();
      return;
    }

    response.status(200);
    response.setHeader('Content-Disposition', 'inline; filename="' + key + '"');
    response.write(body);
    response.end();
    return;
  });
});

router.post('/api/favorites/attach', multipartMiddleware, function(
  request,
  response
) {
  console.log('Upload File Invoked..');
  console.log('Request: ' + JSON.stringify(request.headers));

  let id;

  db.get(request.query.id, function(err, existingdoc) {
    let isExistingDoc = false;
    if (!existingdoc) {
      id = '-1';
    } else {
      id = existingdoc.id;
      isExistingDoc = true;
    }

    let name = sanitizeInput(request.query.name);
    let value = sanitizeInput(request.query.value);

    let file = request.files.file;
    let newPath = './public/uploads/' + file.name;

    let insertAttachment = function(file, id, rev, name, value, response) {
      fs.readFile(file.path, function(err, data) {
        if (!err) {
          if (file) {
            db.attachment.insert(
              id,
              file.name,
              data,
              file.type,
              {
                rev: rev
              },
              function(err, document) {
                if (!err) {
                  console.log('Attachment saved successfully.. ');

                  db.get(document.id, function(err, doc) {
                    console.log(
                      'Attachements from server --> ' +
                        JSON.stringify(doc._attachments)
                    );

                    let attachements = [];
                    let attachData;
                    for (let attachment in doc._attachments) {
                      if (attachment == value) {
                        attachData = {
                          key: attachment,
                          type: file.type
                        };
                      } else {
                        attachData = {
                          key: attachment,
                          type: doc._attachments[attachment]['content_type']
                        };
                      }
                      attachements.push(attachData);
                    }
                    let responseData = createResponseData(
                      id,
                      name,
                      value,
                      attachements
                    );
                    console.log(
                      'Response after attachment: \n' +
                        JSON.stringify(responseData)
                    );
                    response.write(JSON.stringify(responseData));
                    response.end();
                    return;
                  });
                } else {
                  console.log(err);
                }
              }
            );
          }
        }
      });
    };

    if (!isExistingDoc) {
      existingdoc = {
        name: name,
        value: value,
        create_date: new Date()
      };

      // save doc
      db.insert(
        {
          name: name,
          value: value
        },
        '',
        function(err, doc) {
          if (err) {
            console.log(err);
          } else {
            existingdoc = doc;
            console.log('New doc created ..');
            console.log(existingdoc);
            insertAttachment(
              file,
              existingdoc.id,
              existingdoc.rev,
              name,
              value,
              response
            );
          }
        }
      );
    } else {
      console.log('Adding attachment to existing doc.');
      console.log(existingdoc);
      insertAttachment(
        file,
        existingdoc._id,
        existingdoc._rev,
        name,
        value,
        response
      );
    }
  });
});

router.post('/api/favorites', function(request, response) {
  console.log('Create Invoked..');
  console.log('Name: ' + request.body.name);
  console.log('Value: ' + request.body.value);

  // let id = request.body.id;
  let name = sanitizeInput(request.body.name);
  let value = sanitizeInput(request.body.value);

  saveDocument(null, name, value, response);
});

router.delete('/api/favorites', function(request, response) {
  console.log('Delete Invoked..');
  let id = request.query.id;
  // let rev = request.query.rev; // Rev can be fetched from request. if
  // needed, send the rev from client
  console.log('Removing document of ID: ' + id);
  console.log('Request Query: ' + JSON.stringify(request.query));

  db.get(
    id,
    {
      revs_info: true
    },
    function(err, doc) {
      if (!err) {
        db.destroy(doc._id, doc._rev, function(err, res) {
          // Handle response
          if (err) {
            console.log(err);
            response.sendStatus(500);
          } else {
            response.sendStatus(200);
          }
        });
      }
    }
  );
});

router.put('/api/favorites', function(request, response) {
  console.log('Update Invoked..');

  let id = request.body.id;
  let name = sanitizeInput(request.body.name);
  let value = sanitizeInput(request.body.value);

  console.log('ID: ' + id);

  db.get(
    id,
    {
      revs_info: true
    },
    function(err, doc) {
      if (!err) {
        console.log(doc);
        doc.name = name;
        doc.value = value;
        db.insert(doc, doc.id, function(err, doc) {
          if (err) {
            console.log('Error inserting data\n' + err);
            return 500;
          }
          return 200;
        });
      }
    }
  );
});

router.get('/api/favorites', function(request, response) {
  console.log('Get method invoked.. ');

  db = cloudant.use(dbCredentials.dbName);
  let docList = [];
  let i = 0;
  db.list(function(err, body) {
    if (!err) {
      let len = body.rows.length;
      console.log('total # of docs -> ' + len);
      if (len == 0) {
        // push sample data
        // save doc
        let docName = 'sample_doc';
        let docDesc = 'A sample Document';
        db.insert(
          {
            name: docName,
            value: 'A sample Document'
          },
          '',
          function(err, doc) {
            if (err) {
              console.log(err);
            } else {
              console.log('Document : ' + JSON.stringify(doc));
              let responseData = createResponseData(
                doc.id,
                docName,
                docDesc,
                []
              );
              docList.push(responseData);
              response.write(JSON.stringify(docList));
              console.log(JSON.stringify(docList));
              console.log('ending response...');
              response.end();
            }
          }
        );
      } else {
        body.rows.forEach(function(document) {
          db.get(
            document.id,
            {
              revs_info: true
            },
            function(err, doc) {
              if (!err) {
                if (doc['_attachments']) {
                  let attachments = [];
                  for (let attribute in doc['_attachments']) {
                    if (
                      doc['_attachments'][attribute] &&
                      doc['_attachments'][attribute]['content_type']
                    ) {
                      attachments.push({
                        key: attribute,
                        type: doc['_attachments'][attribute]['content_type']
                      });
                    }
                    console.log(
                      attribute +
                        ': ' +
                        JSON.stringify(doc['_attachments'][attribute])
                    );
                  }
                  let responseData = createResponseData(
                    doc._id,
                    doc.name,
                    doc.value,
                    attachments
                  );
                } else {
                  let responseData = createResponseData(
                    doc._id,
                    doc.name,
                    doc.value,
                    []
                  );
                }

                docList.push(responseData);
                i++;
                if (i >= len) {
                  response.write(JSON.stringify(docList));
                  console.log('ending response...');
                  response.end();
                }
              } else {
                console.log(err);
              }
            }
          );
        });
      }
    } else {
      console.log(err);
    }
  });
});

module.exports = router;
