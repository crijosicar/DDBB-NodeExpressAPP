'use strict';

const http = require('http');
const express = require('express');
const Conversation = require('watson-developer-cloud/conversation/v1');
const SpeechToTextV1 = require('watson-developer-cloud/speech-to-text/v1');
const formidable = require('formidable');
const fs = require('fs-extra');

//const soap = require('soap-as-promised');
const session = require('express-session');
const path = require("path");
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const Promise = require('promise');
const querystring = require('querystring');
const engines = require('consolidate');
const compression = require('compression');
const helmet = require('helmet');
const csp = require('helmet-csp');
const xssFilter = require('x-xss-protection');
const cors = require('cors');
const kue = require('kue');
const queue = kue.createQueue();
const async = require('async');


var soap = require('./soap.js');
var admin = require('./admin.js');
var read = require('./readFile.js');
var adminDiscovery = require('./admin-discovery');
const mix = require('./mix.js');
var apiDiscovery = require('./api-discovery');

const corsOptions = {
    origin: "*",
    methods: ['GET', 'PUT', 'POST'],
    headers: "X-Requested-With,content-type",
    optionsSuccessStatus: 200
};

//86400000 = 24 horas
const sess = {
    secret: 'foo',
    cookie: {maxAge: 600000},
    resave: true,
    saveUninitialized: true
};

var interval = 5000;
queue.watchStuckJobs();

var app = express();
var sender;

//Se define la compresion GZIP
app.use(compression({threshold: 0}));

// Bootstrap application settings
app.use(session(sess));
app.use(cookieParser('foo'));

//Funciones como el uso de json o url enconded y la ruta de los archivos de css, imagenes y js
app.use(bodyParser.json({limit: '500mb'}));
app.use(bodyParser.urlencoded({extended: true, limit: '500mb'}));
app.use(express.static(path.join(__dirname, 'public')));

//Se define la tecnologia para utilizar las vistas
app.set('views', __dirname + '/views');
app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');

app.use(helmet());

app.use(csp({
    // Specify directives as normal.
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        childSrc: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"]
    },
    reportOnly: false,
    setAllHeaders: false,
    disableAndroid: false,
    safari5: false
}));

app.use(xssFilter());
app.use(helmet.frameguard());
app.disable('x-powered-by');
app.disable('etag');

app.use(cors(corsOptions));

//Se definbe el timezone para el proyecto
process.env.TZ = 'America/Bogota';

// Create the service wrapper
var conversation = new Conversation({
    // If unspecified here, the CONVERSATION_USERNAME and CONVERSATION_PASSWORD env properties will be checked
    // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
    username: process.env.CONVERSATION_USERNAME,
    password: process.env.CONVERSATION_PASSWORD,
    url: process.env.URL_CONVERSATION,
    version_date: '2016-12-05',
    version: 'v1'
});

var speechToText = new SpeechToTextV1({
    username: process.env.SPEECH_TO_TEXT_USERNAME,
    password: process.env.SPEECH_TO_TEXT_PASSWORD
});

// Endpoint to be call from the client side
app.post('/api/message', function (req, res) {
    sender = {sessionId: req.sessionID};
    var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
    if (!workspace || workspace === '<workspace-id>') {
        return res.json({
            'output': {
                'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the '
                        + '<a href="https://github.com/watson-developer-cloud/conversation-simple">README</a> documentation on how to set this variable. <br>'
                        + 'Once a workspace has been defined the intents may be imported from '
                        + '<a href="https://github.com/watson-developer-cloud/conversation-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
            }
        });
    }

    var payload = {
        workspace_id: workspace,
        context: req.body.context || {},
        input: req.body.input || {}
    };

    // Send the input to the conversation service
    conversation.message(payload, function (err, data) {
        if (err) {
            return res.status(err.code || 500).json(err);
        }
        read.readQuestion(mix.updateMessage(payload, data))
                .then(function (data) {
                    if (data.input.text !== undefined) {
                        admin.sendConversation(data, sender)
                                .then(function (response) {
                                    return res.json([response, req.session, sender]);
                                }, function (error) {
                                    console.log(error, '2');
                                    res.status(error.code || 500).json(error);
                                });
                    } else {
                        data.questionAssociated = [];
                        return res.json([data, req.session, sender]);
                    }
                }, function (error) {
                    return res.status(error.code || 500).json(error);
                });

    });
});

//Funcion que valida el origen
app.use(function (req, res, next) {
    if (process.env.URL_FRONTEND !== req.get('Host')) {
        res.status(404).send({error: 'Something failed!'});
    } else {
        next();
    }
});

//Funcion que envia el quizz
app.post('/api/sendQuizz', function (req, res) {
    sender = {sessionId: req.sessionID};
    admin.sendQuizz(req.body.quizz, sender)
            .then(function (response) {
                return res.json([response, sender]);
            }, function (error) {
                res.status(error.code || 500).json(error);
            });
});

//Funcion que envia la calificación
app.post('/api/sendQuality', function (req, res) {
    sender = {sessionId: req.sessionID};
    admin.sendQuality(req.body.id, sender, req.body.quality)
            .then(function (response) {
                return res.json([response, sender]);
            }, function (error) {
                console.log(error, '3');
                res.status(error.code || 500).json(error);
            });
});

/**
 * Funcion que carga la ruta base del sitio
 * @param  {Request} req    Contiene la información del request que se hace 
 * @param  {Response} res   Contiene la información del response del sitio    
 */
app.get('/', function (req, res) {
    setUrlBase(req);
    var tempo = getTemporality();
    admin.getSpotlightQuestion().then(function (data) {
        res.render(path.join(__dirname, 'views/index.html'), {temporability: tempo.temporability, gretting: tempo.gretting, questions: data, year: tempo.year});
    }, function (e) {
        return res.status(500).json(e);
    });
});

app.put('/api/save-file', function (req, res) {
    var buf = new Buffer(req.body.blob, 'base64'); // decode
    fs.writeFile("uploads/test.wav", buf, function (err) {
        if (err) {
            console.log("err", err);
        } else {
            speechToTextFunction("uploads/test.wav")
                    .then(function (data) {
                        return res.json({'status': 'success', 'message': data.transcript, 'confidence': data.confidence});
                    }, function (e) {
                        return res.status(e.code || 500).json(e);
                    });
        }
    });
});

app.get('/test', function (req, res) {
    setUrlBase(req);
    res.render(path.join(__dirname, 'views/test.html'), {});
});

/**
 * Funcion que obtiene la informacion de discovery
 * @param  {Request} req    Contiene la información del request que se hace
 * @param  {Response} res   Contiene la información del response del sitio    
 */
app.get('/api/query/discovery/:entities/:nlq', (req, res, next) => {
    try {
        let body ={
            ett: req.params.entities,
            nlq: req.params.nlq
        };
        apiDiscovery.fetchPompipeData(body, function(err, data){
            if (err) {
                console.log("err", err);
                return res.status(500).json(err);
            } else {
                return res.send(data);
                /* return res.json(data); */
            }
        });
    } catch (e) {
        return res.status(500).json(e);
    }
});

/**
 * Funcion que actualiza la informacion del API (SOLR)
 * @param  {Request} req    Contiene la información del request que se hace
 * @param  {Response} res   Contiene la información del response del sitio    
 * @param  {String} obra    Hace referncia a la obra a la cual se le va a hacer la actualizacion 
 * @param  {Number} start   Hace referncia a número de la página desde la que se deben a empezar a buscar los datos.
 * @param  {Number} rows    Hace referncia a número de páginas que se van a retornar, si se coloca el número cero (0) quiere decir todas.   
 */
app.get('/admin/create-update/discovery/:obra', (req, res, next) => {
    try {
        
        adminDiscovery.getJsonFromSOLR(req.params.obra, 'json')
            .then(function (dataJSON) {

                getAllPages(dataJSON.response.numFound, req.params.obra)
                    .then(function (dataAllPages) {

                        adminDiscovery.formatJsonForDiscovery(dataAllPages)
                            .then(function (dataAllPagesFormated) {
                                
                                var queues = dataAllPagesFormated.map(function (x, idx) {
                                    return adminDiscovery.createConverQueue(x, `${req.params.obra}-${x.categoria}`, idx, function() {});
                                });
                                
                                adminDiscovery.processAddAllConverQueues();
                                
                                adminDiscovery.processAddAllChildrenConverQueues();
                                
                                adminDiscovery.shuttingDownProcess(dataJSON.response.numFound);
                                
                                return res.status(200).json({result: "Queues are processing"});

                            }, function (e) {
                                return res.status(500).json(e);
                            });

                    }, function (e) {
                        return res.status(500).json(e);
                    });

            }, function (e) {
                    return res.status(500).json(e);
            });

    } catch (e) {
        return res.status(500).json(e);
    }
});

// this code can be cleaned up quite a bit... and will probably have to be written into a redis script instead
// the interval we want to check the active job list for stuck jobs:
setInterval(function() {

  // first check the active job list (hopefully this is relatively small and cheap)
  // if this takes longer than a single "interval" then we should consider using
  // setTimeouts
  queue.active(function (err, ids) {

    // for each id we're going to see how long ago the job was last "updated"
    async.map(ids, function(id, cb) {
      // we get the job info from redis
      kue.Job.get(id, function(err, job) {
        if (err) { throw err; } // let's think about what makes sense here

        // we compare the updated_at to current time.
        var lastUpdate = +Date.now() - job.updated_at;
        if (lastUpdate > 2000) {
          console.log('job ' + job.id + 'hasnt been updated in' + lastUpdate);
          job.remove();
        } else {
          cb(null);
        }

      });
    });
  });
}, interval);

/**
 * Funcion que eliminia un documento de Discovery
 * @param  {Request} req    Contiene la información del request que se hace
 * @param  {Response} res   Contiene la información del response del sitio    
 */
app.get('/admin/delete-document/discovery/:idDocument', (req, res, next) => {
    try {
        adminDiscovery.deleteADiscDocument(req.params.idDocument)
            .then(function (response) {
                return res.status(200).json(response);
            }, function (e) {
                return res.status(500).json(e);
            });
    } catch (e) {
        return res.status(500).json(e);
    }
});

/**
 * Funcion muestra la pagina de error 404
 * @param  {Request} req    Contiene la información del request que se hace 
 * @param  {Response} res   Contiene la información del response del sitio    
 */
app.get('*', function (req, res) {
    setUrlBase(req);
    var tempo = getTemporality();
    res.render(path.join(__dirname, 'views/404.html'), {
        temporability: tempo.temporability,
        gretting: tempo.gretting.gretting, 
        message: "Página no encontrada.", 
        questions: {},
        year: tempo.year
    });
});

/**
 * Funcion de interpretar el texto de un audio
 * @param  {String} url Contiene el la url del audio
 * @return {[type]}     [description]
 */
function speechToTextFunction(url) {
    return new Promise(function (fulfill, reject) {
        var params = {
            // From file
            audio: fs.createReadStream(url),
            content_type: 'audio/l16; rate=44100;',
            model: 'es-ES_BroadbandModel',
            'max_alternatives': 3,
            timestamps: false
        };

        speechToText.recognize(params, function (err, res) {
            if (err) {
                reject(err);
            } else {

                for (var i = 0; i < res.results[0].alternatives.length; i++) {
                    if (res.results[0].alternatives[i].confidence !== undefined) {
                        fulfill(res.results[0].alternatives[i]);
                    }
                }
            }
        });
    });
}


/**
 * Funcion para recorrer y traer las páginas
 * @param  {String} numPages Contiene el numero de total de resultados
 * @return {String} obra Contiene el nombre de la obra
 */
function getAllPages(numPages, obra) {
    return new Promise(function (fulfill, reject) {
        adminDiscovery.getJsonFromSOLR(obra, 'json', 0, numPages)
            .then(function (data) {
                fulfill(data);
            }, function (e) {
                reject(e);
            });
    });
}

/**
 * Funcion base que inicializa la url base en la variables locales
 * @param {Request} req contiene la información del request
 */
function setUrlBase(req) {
    app.locals.base = req.protocol + '://' + req.get('host') + '/';
}

function getTemporality() {

    var date = new Date();
    var objTemp = {
        temporability: "",
        gretting: {
            gretting: "",
            question: "¿En qué te puedo ayudar?"
        },
        year: date.getFullYear()
    };

    if (date.getHours() > 17)
    {
        objTemp.temporability = 'night';
        objTemp.gretting.gretting = "Buenas noches";
    } else if (date.getHours() > 11)
    {
        objTemp.temporability = 'afternoon';
        objTemp.gretting.gretting = "Buenas tardes";
    } else if (date.getHours() > 1)
    {
        objTemp.temporability = 'goodmorning';
        objTemp.gretting.gretting = "Buenos días";
    }

    return objTemp;
}

module.exports = app;