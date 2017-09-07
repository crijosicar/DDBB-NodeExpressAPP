'use strict';
const request = require('request');

var admin = {
    /**
     * Envio de conversación al administrador
     * @param  {JSON} conversation Contiene los datos de la conversacion
     * @param  {Object} sessionId    contiene el objecto de la seccion
     */
    sendConversation: function (conversation, sessionId) {
        return new Promise(function (fulfill, reject) {
            request({
                url: process.env.URL_BACKEND + '/conversacion',
                method: 'POST',
                body: JSON.stringify({
                    jsonConversation: conversation,
                    sessionId: sessionId,
                    type: 'conversation'
                }),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': process.env.TOKEN
                }
            }, function (error, response, body) {
                if (error) {
                    reject(error);
                } else if (response.body.error) {
                    reject(response.body.error);
                } else {

                    var jsonAnswer = JSON.parse(response.body);
                    conversation.questionAssociated = jsonAnswer.question_assoc;
                    conversation.id = jsonAnswer.id;
                    fulfill(conversation);
                }
            });
        });
    },
    sendQuality: function(id, sessionId, quality){
        return new Promise(function (fulfill, reject) {
            request({
                url: process.env.URL_BACKEND + '/conversacion',
                method: 'POST',
                body: JSON.stringify({
                    id: id,
                    quality : quality,
                    sessionId: sessionId,
                    type: 'quality'
                }),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': process.env.TOKEN
                }
            }, function (error, response, body) {
                if (error) {
                    reject(error);
                } else if (response.body.error) {
                    reject(response.body.error);
                } else {
                    var jsonAnswer = JSON.parse(response.body);
                    console.log(jsonAnswer);
                    //conversation.questionAssociated = jsonAnswer.question_assoc;
                    fulfill(id);
                }
            });
        });
    },
    getSpotlightQuestion: function () {
        return new Promise(function (fulfill, reject) {
            request({
                url: process.env.URL_BACKEND + '/pregunta_asociada',
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': process.env.TOKEN
                }
            }, function (error, response, body) {
                if (error) {
                    reject(error);
                } else if (response.body.error) {
                    reject(response.body.error);
                } else {
                    fulfill(JSON.parse(response.body));
                }
            });
        });
    },
    sendQuizz: function (quizz, sender) {
        return new Promise(function (fulfill, reject) {
            request({
                url: process.env.URL_BACKEND + '/evaluacion',
                method: 'POST',
                body: JSON.stringify({
                    quizz: quizz,
                    sessionId: sender
                }),
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': process.env.TOKEN
                }
            }, function (error, response, body) {
                if (error) {
                    reject(error);
                } else if (response.body.error) {
                    reject(response.body.error);
                } else {
                    console.log(response.body);
                    var jsonAnswer = JSON.parse(response.body);
                    fulfill(jsonAnswer);
                }
            });
        });
    }
}


module.exports = admin;