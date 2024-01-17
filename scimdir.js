// Simple SCIM directory application, based on the SCIMMY middleware
// Winston Bond, 2022

// import the packages we need
import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path"
import pug from "pug";
import express from "express";
import favicon from "serve-favicon";
import scimfilter from 'scim2-parse-filter';
import { randomUUID, createHash } from 'crypto';
import { Mutex } from 'async-mutex';
import SCIMMYRouters, {SCIMMY} from "scimmy-routers";

// default config settings
const defaults = {
    // base URL for the SCIM API
    'scimbase' : '/scim/v2',
    
    // port number to use, unless the 'PORT' environment variable is defined
    'scimport' : '2000',
         
    // basic auth credentials
    'username' : 'admin',
    'password' : 'secret',
    
    // words, logo & colour to customise the web UI 
    'uiwords'  : 'Simple SCIM Directory',
    'uilogo'   : 'logo.png',
    'uicolour' : 'black',
    
    // which nationalities touse for people
    'countries' : [
        'AU','BR','CA','CH','DE','DK','ES','FI','FR','GB','IE','NL','NO','NZ','US'
    ],
    
    // the groups we randomly assign users to & their probabilities
    'groups' : {
        'Vegetarians' : 0.20, 
        'Cyclists'    : 0.33, 
        'Runners'     : 0.33, 
        'Swimmers'    : 0.33, 
        'Musicians'   : 0.20, 
        'Dancers'     : 0.20, 
        'Readers'     : 0.20
    },
    
    // do we assign people to multiple groups or just one?
    'multigroup' : true
};   

// structure for config info
let config;

// Express app object
let app;

//---------------------------------------------------------------------------
// top level function
function main() {    
    // read the config file
    readConfig();

    // start the various parts of the app
    initExpressApp();
    initAPI();
    initUI();
    initSCIM();
}

//---------------------------------------------------------------------------
// read and write the config file
const configfile = 'config.json';

function readConfig() {
    try {
        const newconfig = JSON.parse(fs.readFileSync(configfile));

        config = newconfig[0];
        addDefaultSettings(config);
        userlist  = new IdentityList(newconfig[1]);
        grouplist = new IdentityList(newconfig[2]);
    } catch (e) {
        if (e.code != 'ENOENT') {
            throw e;
        }

        // no config file - create a bearer token and some random users
        const bearer_token = createHash('sha1').update(os.hostname()).digest('hex');
        config = {
            token : bearer_token,
        };
        addDefaultSettings(config);
        
        userlist  = new IdentityList([]);
        grouplist = new IdentityList([]);

        createUsers(3);
    }
}

// use the defaults for anything that isn't defined
function addDefaultSettings(config) {
    Object.keys(defaults).forEach((key) => {
        if (config[key] === undefined) {
            config[key] = defaults[key]
        }
    });
}

async function writeConfig() {
    fs.writeFileSync(configfile, JSON.stringify([ 
            config, 
            userlist.getAll(), 
            grouplist.getAll() 
        ], null, 2));
}

//---------------------------------------------------------------------------
// manage the lists of users and groups
let userlist, grouplist;

// class to represent a list
class IdentityList {
    constructor(ids) {
        this.identities = ids;
        this.lock = new Mutex();
    }

    getAll() {
        return this.identities;
    }

    async add(info) {
        await this.lock.runExclusive(async () => {
            this.identities.push(info);
        });
        nextRevision();
        console.log("Added", JSON.stringify(info));
    }

    async filter(callback) {
        await this.lock.runExclusive(async () => {
            this.identities = this.identities.filter((x) => {
                return callback(x);
            });
        });
        nextRevision();
    }

    async del(id) {
        this.filter((x) => {
            return (x.id != id);
        });
    }

    choose(filter, constraints) {
        let selection = this.identities;
        if (filter) {
            // use scim2-parse-filter instead of SCIMMY's built-in filters
            let newfilter = scimfilter.filter(scimfilter.parse(filter.expression));
            selection = selection.filter(newfilter);
        }

        if (constraints) {
            let si = constraints.startIndex;
            if (si) {
                selection = selection.slice(si-1);
            }

            let ct = constraints.count;
            if (ct) {
                selection = selection.slice(0, ct);
            }
        }
        return selection;
    }
};

// keep track of a revision number for the database 
let revision = 0;

// use a mutex, in case there are updates from the UI and SCIM at the same time
let rev_lock = new Mutex();

function getRevision() {
    return revision;
};

async function nextRevision() {
    await rev_lock.runExclusive(async () => {
        revision++;
        writeConfig();
    });
}

// insert various parts of the metadata into the User/Group info
function addMetaData(obj, restype) {
    if (obj.id === undefined) {
        obj['id'] = randomUUID();
    }

    obj['schemas'] = ['urn:ietf:params:scim:schemas:core:2.0:' + restype];

    if (obj.meta === undefined) {
        obj['meta'] = {};
    }
    obj['meta']['resourceType'] = restype;
    obj['meta']['location'] = config.scimbase + '/' + restype + 's/' + obj.id;

    setModificationTime(obj);
}

function setModificationTime(obj) {
    let now = new Date().toISOString();

    obj['meta']['lastModified'] = now;
    if (obj?.meta?.created === undefined) {
        obj['meta']['created'] = now;
    }
}

// check whether a given user exists
function userExists(name) {
    return userlist.getAll().some((rec) => { return (rec.username == name) })
}

function nameFromId(id) {
    for (let user of userlist.getAll()) {
        if (user.id == id) {
            return user.name.givenname + ' ' + user.name.familyname;
        }
    }
    return ("Unknown user");
}

// create random new users
async function createUsers(count=1) {
    // get some random user info
    const countries = config['countries'].join()
    
    const query = await axios.get("https://randomuser.me/api/?nat=" + countries + "&noinfo&results=" + count);

    // convert info to the SCIM User schema & add to the list of users
    for (let info of query.data.results) {
        let newuser = {
            'displayname' : info.name.first + ' ' + info.name.last,

            'username' : info.login.username,
            'id'       : info.login.uuid,
            'active'   : true,
            'name'     : {
                'honorificprefix' : info.name.title,
                'givenname'       : info.name.first,
                'familyname'      : info.name.last
              },
            'emails'   : [{
                'value' : info.email,
                'type'  : 'work'
              }],
            'phoneNumbers' : [{
                'type'  : 'work',
                'value' : info.phone
              }],
            'addresses' : [{
                'type'       : 'work',
                'locality'   : info.location.city,
                'postalCode' : info.location.postcode.toString(),
                'country'    : info.location.country
              }],
            'groups' : []
        };

        addMetaData(newuser, 'User');
        assignToGroups(newuser);
        
        await userlist.add(newuser);
    }
}



// delete a user
function deleteUser(id) {
    // remove the user from any groups
    grouplist.filter((group) => {
        group.members = group.members.filter((member) => {
            return (member.value != id);
        });

        // remove any empty groups
        return (group.members.length != 0);
    });        

    // remove the user
    userlist.del(id);
}

// randomly assign users to some groups
function findGroup(name) {
    for (let g of grouplist.getAll()) {
        if (g.displayname == name) {
            return g;
        }
    }
    
    let group = {
       'displayname' : name,
       'members'     : []
    };
    addMetaData(group, 'Group');
    grouplist.add(group);
    
    return group
}

function addUserToGroup(groupname, user) {
    let group = findGroup(groupname);
    
    let memberinfo = {
        'value'   : user.id,
        //'display' : user.displayname,
        'type'    : 'User',
        '$ref'    : user.meta.location
    }    
    group.members.push(memberinfo);
    
    let groupinfo = {
        'value'   : group.id,
        'display' : group.displayname,
        'type'    : 'direct',
        '$ref'    : group.meta.location
    }
    user.groups.push(groupinfo);    
}

function assignToGroups(user) {
    if (config['multigroup']) {
        for (let [groupname, probability] of Object.entries(config.groups)) {
            if (Math.random() < probability) {
                addUserToGroup(groupname, user);    
            }
        }
    } else {
        let counter = Math.random();
        for (let [groupname, probability] of Object.entries(config.groups)) {
            if (counter < probability) {
                addUserToGroup(groupname, user);
                user['title'] = groupname;
                return                
            }
            counter -= probability;
        }        
    }   
}

//---------------------------------------------------------------------------
// Top level of the Express app
function initExpressApp() {
    const port = normalizePort(process.env.PORT || config.scimport);
    
    app = express();

    app.use(favicon(path.join('public', 'favicon.png')))
    app.use(express.static('public'))

    app.listen(port, () => {
        console.log(`SCIM Directory app listening on port ${port}`)
    })
}

function normalizePort(val) {
    var port = parseInt(val, 10);
    
    if (isNaN(port)) {
        // named pipe
        return val;
    } else
    if (port >= 0) { 
        // port number
        return port;
    }

    return false;
}


//---------------------------------------------------------------------------
// SCIM interface

function initSCIM() {
    // basic setup for SCIMMY - we support filters & patch
    SCIMMY.Config.set("filter", true);
    SCIMMY.Config.set("patch", true);

    // create event handlers for user operations
    SCIMMY.Resources.declare(SCIMMY.Resources.User)
        .ingress((resource, data) => {
            let record = objectToSimpleJS(data);
            if (!userExists(record.username)) {
                addMetaData(user, 'User');
                assignToGroups(record);
                userlist.add(record);
            }
            return record
        })

        .egress((resource) => {
            let outp = userlist.choose(resource.filter, resource.constraints);
            //if (outp.length != 0) {
            //    console.log("Sent", JSON.stringify(outp));
            //}
            return outp;
        })

        .degress((resource) => {
            deleteUser(resource.id);
        });

    // create event handlers for group operations
    SCIMMY.Resources.declare(SCIMMY.Resources.Group)
        .ingress((resource, data) => {
            let record = objectToSimpleJS(data);

            addMetaData(record, 'Group');
            grouplist.add(record);
            return record
        })

        .egress((resource) => {
            let outp = grouplist.choose(resource.filter, resource.constraints);
            if (outp.length != 0) {
                console.log("Sent", JSON.stringify(outp));
            }
            return outp;
        })

        .degress((resource) => {
            grouplist.del(resource.id);
        });

    // override SCIMMY: accept content type application/json, as well as scim+jsom
    app.use(express.json({type: [ "application/scim+json", "application/json" ], limit: "10mb"}));

    // override SCIMMY: treat an empty PATCH as a GET
    app.patch(config.scimbase + "/Users/:id", async (req, res, next) => {
        let numops = req.body?.Operations?.length;
        if ((numops === undefined) || (numops == 0)) {
            try {
                let value = await new Resource(req.params.id, req.query).get(req.body);
                res.status(!!value ? 200 : 204).send(value);
            } catch (ex) {
                res.status(ex.status ?? 500).send(new SCIMMY.Messages.Error(ex));
            }
        } else {
            next('route');
        }
    });

    // create the string we are expecting for basic auth 
    const authstring = btoa(config.username + ':' + config.password);

    // instantiate SCIMMYRouters & setup authentication
    app.use(config.scimbase, new SCIMMYRouters({
        type: "basic",
        docUri: "http://example.com/help/oauth.html",

        // check authentication
        handler: (req) => {
            const auth = req.header("Authorization");
            if (auth?.startsWith("Basic ")) {
                const creds = auth.substr(6).trim();
                if (creds != authstring) {
                    throw new Error("Basic auth failed");
                }
            } else
            if (auth?.startsWith("Bearer ")) {
                const token = auth.substr(7).trim();
                if (token != config.token) {
                    throw new Error("Incorrect bearer token: " + auth);
                }
            } else {
                throw new Error("Authorization not detected!");
            }
        }
    }));
}

//---------------------------------------------------------------------------
// User interface

// keep track of the last database revision that was rendered
let clientrev;

function uiUpToDate() {
    return (clientrev == getRevision());
}

// start the Pug UI
function initUI() {
    app.set('./views')
    app.set('view engine', 'pug')

    app.get('/', async (req, res) => {
        clientrev = getRevision();
        res.render('main', { 
            users:   userlist.getAll(), 
            groups:  grouplist.getAll(), 
            config:  config, 
            pickColour: chooseColour, 
            nameFromId: nameFromId 
        });
    });
}

// pick a colour for a tile in the UI
const colours =  [
    "00a36c","00bfff","00ced1","00fa9a","00ff00","00ff7f","00ffff","0affff","12ad2b","16e2f5","16f529","20b2aa","3090c7","32cd32",
    "34a56f","357ec7","368bc1","36f57f","38acec","3bb9ff","3cb371","3ea055","3ea99f","3eb489","40e0d0","41a317","43bfc7","43c6db",
    "4682b4","46c7c7","488ac7","48cccd","48d1cc","4aa02c","4cc417","4cc552","4ee2ec","50c878","50ebec","52d017","54c571","56a5ec",
    "57e964","57feff","59e817","5cb3ff","5efb6e","5ffb17","6495ed","64e986","659ec7","6667ab","6698ff","66cdaa","66ff00","6960ec",
    "6a5acd","6aa121","6afb92","6cbb3c","6cc417","728fce","736aff","737ca1","73a16c","7575cf","77bfc7","77dd77","78866b","78c7c7",
    "79baec","7a5dc7","7b68ee","7bccb5","7cfc00","7dfdfe","7f38ec","7fe817","7fff00","7fffd4","81d8d0","82caff","842dce","8467d7",
    "848482","848b79","85bb65","86608e","87afc7","87ceeb","87cefa","87f717","893bff","89c35c","8a2be2","8d38c9","8d918d","8e35ef",
    "8eebec","8fbc8f","90ee90","9172ec","92c7c7","9370db","93ffe8","9400d3","95b9c7","967bb6","98afc7","98f516","98fb98","98ff98",
    "9932cc","99c68e","9acd32","9afeff","9cb071","9d00ff","9dc209","9e7bff","a0cfec","a1c935","a23bec","a74ac7","a9a9a9","aaf0d1",
    "add8e6","addfff","adff2f","afdcec","afeeee","b041ff","b048b5","b0bf1a","b0cfde","b0e0e6","b1fb17","b2c248","b3446c","b4cfec",
    "b5a642","b5eaaa","b666d2","b6b6b4","b7ceec","b93b8f","ba55d3","bab86c","bc8f8f","bcb88a","bcc6cc","bce954","bdb76b","bdedff",
    "bdf516","c0c0c0","c12267","c12283","c19a6b","c25283","c25a7c","c2b280","c2dfff","c38ec7","c3fdb8","c45aec","c48189","c48793",
    "c4aead","c5908e","c6aec7","c6deff","c71585","c7a317","c8a2c8","c8ad7f","c8b560","c9be62","c9c0bb","c9dfec","ca226b","ccccff",
    "ccfb5d","ccffff","cd5c5c","cecece","cfecec","d16587","d1d0ce","d291bc","d2b48c","d2b9d3","d3d3d3","d462ff","d4af37","d58a94",
    "d5d6ea","d891ef","d8bfd8","da70d6","da8a67","daa520","daee01","db7093","dbf9db","dcd0ff","dcdcdc","dda0dd","deb887","df73d4",
    "e0b0ff","e0ffff","e1d9d1","e238ec","e2a76f","e2f516","e38aae","e3e4fa","e3f9a6","e55451","e55b3c","e56e94","e5e4e2","e66c2c",
    "e67451","e6a9ec","e6bf83","e6e6fa","e75480","e77471","e78a61","e799a3","e7a1b0","e8a317","e8adaa","e8e4c9","e9967a","e9ab17",
    "e9cfec","e9e4d4","eac117","ebdde2","ebf4fa","ecc5c0","ece5b6","edc9af","edda74","ede275","ede6d6","ee82ee","ee9a4d","eee8aa",
    "f08080","f0e2b6","f0e68c","f0f8ff","f0fff0","f0ffff","f1e5ac","f2a2e8","f2bb66","f3e3c3","f3e5ab","f433ff","f4a460","f5deb3",
    "f5e216","f5f5dc","f5f5f5","f5fffa","f660ab","f67280","f6be00","f75d59","f778a1","f7e7ce","f87217","f87431","f88017","f88158",
    "f8b88b","f8f0e3","f8f6f0","f8f8ff","f9966b","f9a7b0","f9b7ff","f9db24","fa8072","faafba","faafbe","faebd7","faf0dd","faf0e6",
    "faf5ef","faf884","fafad2","fbb117","fbb917","fbbbb9","fbcfcd","fbe7a1","fbf6d9","fbfbf9","fc6c85","fcdfff","fdd017","fdd7e4",
    "fdeef4","fdf5e6","fea3aa","fed8b1","fefcff","ff00ff","ff5f1f","ff6347","ff6700","ff69b4","ff7722","ff7f50","ff8040","ff8c00",
    "ffa07a","ffa500","ffa62f","ffae42","ffb6c1","ffc0cb","ffcba4","ffcccb","ffce44","ffd700","ffd801","ffdab9","ffdb58","ffddca",
    "ffdead","ffdf00","ffdfdd","ffe4b5","ffe4c4","ffe4e1","ffe5b4","ffe6e8","ffe87c","ffebcd","ffef00","ffefd5","fff0f5","fff380",
    "fff5ee","fff8dc","fff9e3","fffacd","fffaf0","fffafa","fffdd0","ffff00","ffff33","ffffc2","ffffcc","ffffe0","fffff0","fffff7"
];

function chooseColour(str) 
{
    // work out a very simple hash value from the string
    let hash = 0x2022;
    for (let i=0; i<str.length; i++) {
        hash = (hash << 1) + str.charCodeAt(i);
        
        while (hash > 0xffff) {
            hash = (hash >>> 16) ^ (hash & 0xffff);
        }
    }   
    
    // use the hash to pick a colour
    let index = hash % colours.length;      
    return '#' + colours[index];
}


//---------------------------------------------------------------------------
// call back API

function initAPI() {
    // delete and create users from the UI
    app.get('/api', async (req, res) => {
        let query = req.query;

        if (query.op == 'delete') {
            deleteUser(query.id);
        } else
        if (query.op == 'randomuser') {
            createUsers(1);
        } else {
            console.log('Unknown operation');
        }
        res.send('OK');
    });

    // allow the UI to poll for changes in the database
    app.get('/poll', async (req, res) => {
        // wait until there has been a change
        while (uiUpToDate()) {
            await new Promise(r => setTimeout(r, 500));
        }

        // finally respond to the client
        res.send('Database updated');
    });
}


//---------------------------------------------------------------------------
// miscellaneous stuff

// convert a SCIMMY Schema object to plain-old JS
function itemToSimpleJS(value)
{
    if (value === undefined) {
        return value;
    } else
    if (Array.isArray(value)) {
        let result = [];
        for (let x of value) {
            result.push(itemToSimpleJS(x));
        }
        return result;
    } else
    if (typeof(value) == 'object') {
        return objectToSimpleJS(value);
    } else {
        return value;
    }
}

function objectToSimpleJS(schemaobject)
{
    let list = {};
    for (let [key, value] of Object.entries(schemaobject)) {
        if (value === undefined) {
            continue;
        } else {
            list[key.toLowerCase()] = itemToSimpleJS(value);
        }
    }
    return list;
}

// call the main function, at the top of the file
main();
