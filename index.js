const { Client, Intents, MessageEmbed, WebhookClient } = require('discord.js');
const { token, webhookUrl, channelId, email} = require('./config.json');
const TurndownService = require('turndown');

const turndownService = new TurndownService();

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

const DISCORD_MSG_LIMIT = 2000;

var Imap = require('imap'),
    inspect = require('util').inspect;

var imap = new Imap({
  user: email.user,
  password: email.password,
  host: email.host,
  port: email.port,
  tls: email.tls,
  tlsOptions: email.tlsOptions
});

function openInbox(cb) {
  imap.openBox('INBOX', false, cb);
}

const HEADER_FIELDS = "HEADER.FIELDS (FROM TO SUBJECT DATE)";
function exploreParts (array,wp,subtype) {
	for (var i = 0; i < array.length; i++) {
		console.log(array[i])
		if (array[i][0]) {
			exploreParts(array[i],wp,subtype);
		} else{
			if (array[i].type == "text" && array[i].subtype == subtype) {
				wp.push(array[i].partID);
			}
		}
	}
}


// when notification of new mail is received (this is also received whenever we connect to the mailbox...)
imap.on("mail", (numNewMsgs) => {
openInbox(function(err, box) {
  if (err) throw err;

  // look at all the unread emails (should only be 1)
  imap.search([ 'UNSEEN'], function(err, results) {
  	// if no unread quit and don't throw an error
  	if (results.length == 0) {console.log("no msgs"); return}

    if (err) throw err;

    // first we want to get the structures of each message
    var f = imap.fetch(results, { struct: true});
    f.on('message', function(msg, seqno) {
      console.log('Message #%d', seqno);
      var prefix = '(#' + seqno + ') ';

      // initialise our object to store message data.
	  var parsedMsg = {};

	  // only part we initially get are the attributes, in particular we care about the structure
      msg.once('attributes', function(attrs) {
      	parsedMsg.attrs = attrs;

      	// using the structure in the attributes found above,
      	// find the parts of the message we want; initially we look for html parts, then if there are none resort to plaintext
      	var wantedParts = [];
      	exploreParts(attrs.struct,wantedParts,"html");

      	if (wantedParts.length == 0) {
      		exploreParts(attrs.struct,wantedParts,"plain");
      		parsedMsg.subtype = "plain";
      	} else {
      		parsedMsg.subtype = "html"
      	}
      	// finally we also want the header info (specified in the constant HEADER_FIELDS)
      	wantedParts.push (HEADER_FIELDS);
      	console.log (wantedParts);

      	// now fetch (by seqno) the desired content
      	var g = imap.seq.fetch(seqno, {bodies: wantedParts})
      	g.on ('message', function(msg2, seqno) {
      		var body=""
          		, header = '';
          	msg2.on('body', function(stream, info) {
      			console.log(info);
          		if (info.which === HEADER_FIELDS) {
            		stream.on('data', function(chunk) { header += chunk.toString('utf8') })
            		stream.once('end', function() { parsedMsg.header = Imap.parseHeader(header) })
          		} else {
          			stream.on('data', function(chunk) { body += chunk.toString('utf8') })
            		stream.once('end', function() { parsedMsg.body = body })
          		}
        	});

        	msg2.once('end', function() {
        		// mark the message as read so we don't post it again
      			imap.seq.addFlags(seqno, 'Seen', function(err) {console.log(err) });

      			// debugging info
      			console.log(prefix + "Header: %s", inspect(parsedMsg.header))
      			console.log("Body:" + parsedMsg.body);
        		console.log(prefix + 'Finished');

        		// sanitise the message for posting. this includes a weird appearence of =\r\n in piers's emails, and also 3D= in his HTML
        		parsedMsg.body = parsedMsg.body.replace(/(=(\r)?\n)|((?<=\=)3D)/g,"");
        		if (parsedMsg.subtype == "html") {
        			// convert HTML to markdown
        			parsedMsg.body = turndownService.turndown(parsedMsg.body);

        			// deal with links (will be able to remove if posted in an embed)
        			parsedMsg.body = parsedMsg.body.replace(/(?<=\[[^\]]*\])\([^\)]*\)/g,"");
        		}

        		// get channel we want to post in
       			const channel = client.channels.cache.get(channelId);

        		channel.fetchWebhooks().then(webhooks => {
        		const webhook = webhooks.first();
        		// after getting webhook for channel, send the subject as the sender
        		webhook.send({
					content: parsedMsg.header.subject[0],
					username: parsedMsg.header.from[0],
					//avatarURL: 'https://i.imgur.com/AfFp7pu.png',
				}).then(msg => {
					console.log("Created message %s", msg.id);

					// start a new thread on the webhook message just sent
					msg.startThread({
						"name":parsedMsg.header.date[0]
					}).then(thread => {
						// split the text between messages, taking care only to split at whitespace.
						text = parsedMsg.body;
						texts = []; // array of contents for the message parts
						l = text.length;
						var ptr = DISCORD_MSG_LIMIT
						var oldptr = 0;
						// move the "pointer to break at whitespace"
						while (ptr < l) {
							while (text[ptr].match(/\S/)) {
								ptr--;
							}
							texts.push( text.substring(oldptr, ptr));
							oldptr = ptr;
							ptr += DISCORD_MSG_LIMIT;
						}
						texts.push(text.substring(oldptr,l));

						// sequentially send the text parts calculated as above.
						giveMultiMsg(texts,thread).then(()=>{console.log("Sent all msgs")}).catch(err=>{console.log(err)});
					}).catch(err => {
						console.log(err);
					});
				}).catch(err => {
					console.log(err);
				});
        	}).catch(err => {
				console.log(err);
			});
      	});
   			});
      	});
      });

    f.once('error', function(err) {
      console.log('Fetch error: ' + err);
    });
    f.once('end', function() {
      console.log('Done fetching all messages!');
      //imap.end();
    });
  });
});
});

// function which sends the messages in "texts"
async function giveMultiMsg (texts,thread) {
	for (var i = 0; i < texts.length; i++) {
		await thread.send(texts[i]);
	}
}

// flag so that we wait until both discord client and imap client are ready.
var firstReady = false

imap.once('error', function(err) {
  console.log(err);
});

imap.once('end', function() {
  console.log('Connection ended');
});


// when both discord and imap are ready, we open our inbox.
imap.once('ready', function() {
	if (firstReady) {
		openInbox(function (err,box) {console.log("opened box")});
	} else{
		firstReady = true;
	}
})
client.once('ready', async () => {
	if (firstReady) {
		openInbox(function (err,box) {console.log("opened box")});
	} else{
		firstReady = true;
	}
});

imap.connect();
client.login(token);