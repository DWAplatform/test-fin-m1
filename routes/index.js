var express = require('express');
var simpleOauthModule = require('simple-oauth2');
var router = express.Router();
var request = require('request');

// Configuration
const dwaapi_baseurl = process.env.DWAPAY_API;
const tokenHost = process.env.OAUTH2_URL;
const redirect_uri = process.env.FINM1TEST_URL + '/callback';
const clientid = process.env.FINM1TEST_CLIENT_ID;
const secret = process.env.FINM1TEST_CLIENT_SECRET;
// End configuration

// oAuth2
const oauth2 = simpleOauthModule.create({
    client: {
        id: clientid,
        secret: secret
    },
    auth: {
        tokenHost: tokenHost,
        tokenPath: '/oauth2/token',
        authorizePath: '/oauth2/auth'
    }
});

// Authorization uri definition
const authorizationUri = oauth2.authorizationCode.authorizeURL({
    redirect_uri: redirect_uri,
    scope: 'email',
    state: 'mystateobjectexample' // state object to avoid Cross Site Request Forgery (XRSF).
});


//ids of pending Purchases
var pendingPurchases = [];
// map of purchaseid and user socket, for socket.io server-client communication
var clients = new Map();
// logged users
var users = new Map();

module.exports = router;
module.exports.clients = clients;

// GET home page.
router.get('/', function(req, res, next) {
  res.render('index');
});

// Initial page redirecting to DWAPlatform
router.get('/auth', function(req, res) {
  res.redirect(authorizationUri);
});

// Callback service parsing the authorization token and asking for the access token
router.get('/callback', function(req, res) {
  const code = req.query.code;
  const options = {
    code: code,
    redirect_uri: redirect_uri
  };

  oauth2.authorizationCode.getToken(options, function(error, result) {
    if (error) {
        console.error('Access Token Error', error.message);
        return res.json('Authentication failed');
  }

  console.log('The resulting token: ', result);
  const token = oauth2.accessToken.create(result);

  request.get({
      url: dwaapi_baseurl + '/rest/v1/users/verify_credentials',
          json: true,
          'auth': {
              'bearer': token.token.access_token
          }
      },
      function (error, response, body) {
          if (!error && response.statusCode == 200) {
              users.set(body.userid, {payload: body, token: token.token.access_token});
              res.redirect('/welcome?uid=' + body.userid)
          } else {
              if (error) {
                  console.error('Verify Credentials Error', error.message);
              }
              return res.json('Verify Credentials Error');
          }
      }
  );
  });
});

// Page render after login success.
router.get('/welcome', function(req, res) {
    const uid = req.query.uid;
    var user = users.get(uid).payload;
    var token = users.get(uid).token;

    res.render('welcome', {
        title: 'Welcome Page',
        name: user.name,
        surname: user.surname,
        email: user.email,
        userid: user.userid,
        token: token});
});

// Checkout Page.
router.post('/checkout', function(req, res) {
    const userid = req.body.userid;
    var token = req.body.token;

    res.render('checkout', {
        title: 'Checkout Page',
        userid: userid,
        token: token});
});

// Post checkout data
router.post('/waitconfirm', function(req,res) {
    var url = dwaapi_baseurl + '/rest/v1/' + clientid + '/fin/m1/purchases';

    var data = {
        debited_userid: req.body.userid,
        description: req.body.description,
        amount: {
          amount: parseInt(req.body.amount),
          currency: "EUR"
        }
    };

    request.post({
            url: url,
            json: data,
            'auth': {
                'bearer': req.body.token
            }
        }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            pendingPurchases.push(body.purchaseid);

            res.render('waitconfirm', {
                title: 'Client Web',
                purchaseid: body.purchaseid,
                userid: req.body.userid,
                token: req.body.token});
        }
        else {
            console.log(error);
            if (response) console.log(response.statusCode);
            res.send(body);
        }
      }
    );
});


router.get('/purchaseinfo', function(req, res) {

    const token = req.query.token;
    const purchaseid = req.query.purchaseid;

    request.get({
            url: dwaapi_baseurl + '/rest/v1/' + clientid + '/fin/m1/purchases/' + purchaseid,
            json: true,
            'auth': {
                'bearer': token
            }
        },
        function (error, response, body) {
            if (!error && response.statusCode == 200) {
                res.status(200).send(body);
            } else {
                //console.error('Verify Credentials Error', error.message);
                return res.json('Verify Credentials Error');
            }
        }
    );



});


// DWAplatform hook events callback handler
router.post('/dwaplatform/callback', function(req, res) {

    if (req.body.event_type == 'PURCHASE_UPDATED') {

        var purchase = req.body.purchase;
        var purchaseid = purchase.purchaseid;

        var index = pendingPurchases.indexOf(purchaseid);
        if (index >= 0) {
            var msg = '';
            var finalstate = true;
            if (purchase.status == 'CONFIRM_PURCHASE_DENIED') {
                msg = 'User denied purchase';
            }
            else if (purchase.status == 'FUNDS_TRANSFER_ERROR') {
                msg = 'Funds transfer error';
            }
            else if (purchase.status == 'SUCCEEDED') {
                msg = 'Success';
            }
            else {
                finalstate = false;
            }

            if (finalstate) {
                var socket = clients.get(purchaseid);
                socket.emit('msg', msg);
            }
        }
    }

    res.status(200).send({});

});



