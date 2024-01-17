# README
This is a very simple test/demo app that allows users and groups to be accessed through a SCIM API.

The SCIM underpinnings are built on SCIMMY. https://github.com/scimmyjs
Thanks to Sam Lee-Lindsay for releasing that - it certainly made SCIM a lot more digestable.

The code is released under an MIT license. Essentially: do what you want, but don't sue me if it all goes wrong.

## Updating Node on Linux
This app requires Node to be newer than version 16, but many Linux distros come with fairly old Node versions. 

To update using npm and the n node version manager ...

    sudo -s
    apt install npm      
    npm cache clean -f
    npm install -g n
    n stable
    exit

That's for Debian, Ubuntu and friends. For the RHEL/CentOS family, replace the apt command with yum or dnf. For Suse, it's zypper. 
  
## Setup
To download all the required npm packages, before you start the server for the first time ...

    npm install

## Running the server
To start the server:

    node .
    
By default, the server will listen on port 2000   

The port can be changed either by setting the PORT environment variable (as required for Web App hosting on Azure) or by changing the app's config file (see below).

## The UI
To access the UI in a web browser, look at http://yourhostname:2000

When the app is started for the first time, it will create 3 random users and randomly assign them to some groups. To create another user in the UI, hit the + button. To delete one, hit the X.

The user info comes from www.randomuser.me. Thanks to whoever is behind that. I'd say a more personalized thank you, but the name changes every time I look ;-)

## SCIM access
By default, the SCIM interface will be at http://yourhostname:2000/scim/v2/

The default login credentials (the app uses http basic auth) for the SCIM interface are admin & secret

Or you can use a bearer token. The bearer token for your server is shown in the Settings tab of the UI. The default token is generated from the server name

The login credentials and the bearer token can all be changed in the config file.

## config.json
User, group and config information is saved in a file called config.json, in the app's home directory. It will be created the first time the app runs.

The config info is in the first part of the file and these are the defaults.
 
    // base URL for the SCIM API
    'scimbase' : '/scim/v2',
    
    // port number to use, unless the 'PORT' environment variable is defined
    // 80 would be the normal value for an http server, but using another port avoids conflicts
    'scimport' : '2000',
         
    // basic auth credentials, for SCIM access
    'username' : 'admin',
    'password' : 'secret',
    
    // bearer token for auth
    'token'    :  .... defaults to a hash of the host name of the server ....

    // words, logo & colour to customise the web UI 
    'uiwords'  : 'Simple SCIM Directory',
    'uilogo'   : 'logo.png',
    'uicolour' : 'black',
    
    // which nationalities to use for people
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
    }

    // do we assign people to multiple groups or just one?
    'multigroup' : true

If you want to use a better password, change the details of the UI (handy if you are running multiple instances) or use more sensible group names then stop the app, customise the file and restart. 

To reset everything and forget all the users/groups then just delete config.json. 

--
Winston Bond
July 2022