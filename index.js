const { Client, Intents, MessageEmbed, WebhookClient } = require('discord.js');
const { token, webhookUrls, email, listAddr} = require('./config.json');
const TurndownService = require('turndown');

const turndownService = new TurndownService();

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });

const DISCORD_MSG_LIMIT = 2000;
const DISCORD_EMBED_LIMIT = 4096;
const DISCORD_TITLE_LIMIT = 256;
const ELLIPSIS = "[...]";

var Imap = require('imap'),
    inspect = require('util').inspect;

var imap = new Imap({
  user: email.user,
  password: email.password,
  host: email.host,
  port: email.port,
  tls: email.tls,
  tlsOptions: email.tlsOptions,
  keepalive: true
});

function openInbox(cb) {
  imap.openBox('INBOX', false, cb);
}

const HEADER_FIELDS = "HEADER.FIELDS (FROM TO SUBJECT DATE)";
function exploreParts (array,wp,subtype) {
	for (var i = 0; i < array.length; i++) {
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
imap.on("mail", (newmsgs) => {
if (newmsgs == 0) {
	console.log("no msgs - seen immediately");
}
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
      	console.log(attrs);

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
      			//console.log(info);
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
      			imap.end();

				if (parsedMsg.header.to[0] != listAddr) {
					console.log("not mailing list");
					return;
				}
      			// debugging info
      			//console.log(prefix + "Header: %s", inspect(parsedMsg.header))
      			//console.log("Body:" + parsedMsg.body);
        		//console.log(prefix + 'Finished');
        		// sanitise the message for posting. this includes a weird appearence of =\r\n in piers's emails, and also 3D= in his HTML
        		//parsedMsg.body = parsedMsg.body.replace(/(=(\r)?\n)|((?<=\<[^\>\<]*\=)[0-9A-F]{2})(?=[^\>]*\>)/g,"");

        		// decode quoted-printable encoding
        		parsedMsg.body = parsedMsg.body.replace(/(=(\r)?\n)/g,"");
        		parsedMsg.body = parsedMsg.body.replace(/(\=[0-9A-F]{2})+/g, function (x) {
        				hexcodes = x.split("=").join("");
        				return Buffer.from(hexcodes, "hex").toString("utf-8");

        			});


        		if (parsedMsg.subtype == "html") {
        			// convert HTML to markdown
        			parsedMsg.body = turndownService.turndown(parsedMsg.body);
        		}

       			lines = parsedMsg.body.split(/(\r)?\n/);
       			embeds = [];
       			ct = "";
            var quoted;
       			for (var i = 0; i < lines.length; i++) {
              try {
                lines[i].length;
              } catch(err) {
                continue;
              }
              lines[i] += "\r\n";
              // if can add the line then do
       				if ( (ct.length + lines[i].length) < (DISCORD_EMBED_LIMIT)) {
       					ct += lines[i];
       				} else {
               // console.log("limit reached");
                // if couldn't add the line due to the new line being too long
                if (lines[i].length >= (DISCORD_EMBED_LIMIT)) {
                  // push current text if it isn't trivial
                  if (ct.length > 0) {
                    embeds.push( new MessageEmbed().setDescription(ct) );
                  }


                  q = ( (lines[i].substr(0,2) == "> ") ? 2 : 0);
                  Qu = ( q == 2 ? "> " : "");

                  while (ct.length >= DISCORD_EMBED_LIMIT) {
                    ptr = DISCORD_EMBED_LIMIT;
                    // move pointer to hit a whitespace char, or brute-force it if necessary
                    while (ct[ptr].match(/\S/)) {
                      ptr--;
                      if (ptr == oldptr) {
                        // brute-force condn
                        ptr = DISCORD_EMBED_LIMIT;
                        break;
                      }
                    }
                    embeds.push( new MessageEmbed().setDescription(ct.substr(0,ptr)) );
                    ct = Qu + ct.substr(ptr, ct.length);
                  }
                  // when we have got the line down to an acceptable length, we can let it continue as the current text
                } else {
                  // if no issue just push the text and set current text to the line
                  embeds.push( new MessageEmbed().setDescription(ct) );

                  //console.log("line fine: text len %s, line len %s", ct.length, lines[i].length);
                  ct = lines[i];
                }
       				}
       			}
       			// put datestamp on final embed
       			embeds.push(new MessageEmbed().setDescription(ct).setTimestamp(parsedMsg.header.date[0]));

       			// truncate subject if too long
       			subj = parsedMsg.header.subject[0];
       			if (subj.length > DISCORD_TITLE_LIMIT) {
       				subj = subj.substr(0, DISCORD_TITLE_LIMIT - ELLIPSIS.length) + ELLIPSIS;
       			}

            fullAuthor = parsedMsg.header.from[0];
            lst = fullAuthor.split("<");
            eaddr = lst[lst.length-1];
            eaddr = eaddr.substr(0,eaddr.length-1);
            name = lst.slice(0,lst.length-1).join("<");

       			// put subject and sender on first embed
       			embeds[0].setTitle(subj).setAuthor(eaddr);

        		// get webhook, and then use it to send embeds
        		webhookUrls.forEach( (url) => {
                    var webhookClient = new WebhookClient({ url: url });
       			    sendEmbeds(webhookClient, embeds, name).then(() => {
       				    console.log("Sent");
       			    }).catch((err) => {
       				    console.log(err);
       			    });
        		});

        	});
      	});
      	});
      });

    f.once('error', function(err) {
      console.log('Fetch error: ' + err);
      imap.end();
    });
    f.once('end', function() {
      console.log('Done fetching all messages!');
    });
  });
});
});

const WEBHOOK_EMBEDS_PER_MSG = 10;

async function sendEmbeds( wh, embeds, username) {
	// send the embeds 10 per msg
	/*ptr = WEBHOOK_EMBEDS_PER_MSG;
	oldptr = 0;
	while (ptr < embeds.length) {
		await wh.send({
			embeds : embeds.slice(oldptr,ptr),
			username: username
		});
		oldptr = ptr;
		ptr += WEBHOOK_EMBEDS_PER_MSG;
	}
	await wh.send({
		embeds : embeds.slice(oldptr,embeds.length),
		username: username
	});*/
	for (var i=0; i < embeds.length;i++) {
		await wh.send({
			username: username,
			embeds: [embeds[i]]
		});
	}
}

imap.once('error', function(err) {
  console.log(err);
});

// reconnect if connection ends
imap.on('end', function() {
  console.log('Connection ended at %s', new Date());
  imap.connect();
});

// open inbox when we connect so we receive mail notifications
imap.on('ready', function() {
	openInbox(function (err,box) {console.log("opened box at %s",new Date())});
})

imap.connect();
console.log("Test???");