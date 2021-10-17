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
function exploreParts (array,wp) {
	for (var i = 0; i < array.length; i++) {
		console.log(array[i])
		if (array[i][0]) {
			exploreParts(array[i],wp);
		} else{
			if (array[i].type == "text" && array[i].subtype == "html") {
				wp.push(array[i].partID);
			}
		}
	}
}


imap.on("mail", (numNewMsgs) => {
openInbox(function(err, box) {
  if (err) throw err;
  imap.search([ 'UNSEEN'], function(err, results) {
  	if (results.length == 0) {console.log("no msgs"); return}
    if (err) throw err;

    // first get the structure to figure out where html part is

    var f = imap.fetch(results, { struct: true});//, bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', '2']});
    f.on('message', function(msg, seqno) {
      console.log('Message #%d', seqno);
      var prefix = '(#' + seqno + ') ';
		var parsedMsg = {};
      msg.once('attributes', function(attrs) {
      	parsedMsg.attrs = attrs;
        //console.log(prefix + 'Attributes: %s', inspect(attrs, false, 8));
      });

      msg.once('end', function () {
      	parsedMsg.wantedParts = [];
      	exploreParts(parsedMsg.attrs.struct,parsedMsg.wantedParts);
      	parsedMsg.wantedParts.push (HEADER_FIELDS);
      	console.log (parsedMsg.wantedParts);
      	var g = imap.seq.fetch(seqno, {bodies: parsedMsg.wantedParts})
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
      			imap.seq.addFlags(seqno, 'Seen', function(err) {console.log(err) });
      			console.log(prefix + "Header: %s", inspect(parsedMsg.header))
      			console.log("Body:" + parsedMsg.body);
        		console.log(prefix + 'Finished');

        		parsedMsg.body = parsedMsg.body.replace(/(=(\r)?\n)|((?<=\=)3D)/g,"");
        		parsedMsg.body = turndownService.turndown(parsedMsg.body);
        		parsedMsg.body = parsedMsg.body.replace(/(?<=\[[^\]]*\])\([^\)]*\)/g,"");

       			const channel = client.channels.cache.get(channelId);
        		channel.fetchWebhooks().then(webhooks => {
        		const webhook = webhooks.first();
        		webhook.send({
					content: parsedMsg.header.subject[0],
					username: parsedMsg.header.from[0],
					//avatarURL: 'https://i.imgur.com/AfFp7pu.png',
				}).then(msg => {
					console.log("Created message %s", msg.id);
					msg.startThread({
						"name":parsedMsg.header.date[0]
					}).then(thread => {
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
						giveMultiMsg(0,texts,thread).then(()=>{console.log("Sent all msgs")}).catch(err=>{console.log(err)});
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

async function giveMultiMsg (current_index,texts,thread) {
	if (current_index >= texts.length) {return}
	else {
		await thread.send(texts[current_index]);
		await giveMultiMsg(current_index+1, texts, thread);
	}
}


var firstReady = false



imap.once('error', function(err) {
  console.log(err);
});

imap.once('end', function() {
  console.log('Connection ended');
});

imap.connect();

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
	/*try {
		

		msg = await webhook.send({
			content: 'Subject line I guess',
			username: 'email-address',
			avatarURL: 'https://i.imgur.com/AfFp7pu.png',
		});
		thread = await msg.startThread ({
			name:"​Subject Line" // I don't really like this but I don't seem to have much choice.
		});
		
		await thread.send("Message text");
	} catch (error) {
		console.error('Error trying to send a message: ', error);
	}*/
});

client.login(token);