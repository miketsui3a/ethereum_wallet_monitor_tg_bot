require("dotenv").config();
const Web3 = require("web3");
const abiDecoder = require("abi-decoder");
const fs = require("fs");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const NodeCache = require("node-cache");

const myCache = new NodeCache({ stdTTL: 5 });

const erc20Abi = require("./erc20Abi.json");
const routerAbi = require("./routerAbi.json");
const targetAddressJson = require("./targetAddress.json");

const TelegramBot = require("node-telegram-bot-api");
// let web4 = new Web3(process.env.WEB3_WEBSOCKET_ENDPOINT);
let web4 = new Web3(process.env.WEB3_HTTP_ENDPOINT);

const bot = new TelegramBot(process.env.TG_BOT_API_KEY, { polling: true });

abiDecoder.addABI(erc20Abi);
abiDecoder.addABI(routerAbi);

async function ftmScan(candidates, currentIndex) {
  const selectedCandidates = []
  const targetGroupIds = require("./groupIds.json");
  const loopUntil = candidates.length > 5 ? 5 : candidates.length
  for (let i = 0; i < loopUntil; i++) {
    selectedCandidates.push(candidates[currentIndex.idx])
    currentIndex.idx = (currentIndex.idx + 1) % candidates.length
  }

  console.log("selected candidate: ", selectedCandidates)


  selectedCandidates.map(async x => {
    const response = await fetch(`https://api.ftmscan.com/api?module=account&action=tokentx&address=${x.address}&page=1&offset=10&startblock=0&endblock=999999999&sort=desc&apikey=${process.env.FTMSCAN_API_KEY}`)
    const data = await response.json()
    const cache = myCache.get("targetAddress");
    const idx = cache.findIndex((z) => z.address == x.address);
    cache[idx].lastNonce = data.result[0].nonce
    myCache.set("targetAddress", cache);

    console.log("x:", x)
    const newTransferEvent = data.result.filter(evt => {
      let ok = false
      console.log("first harsh: ", evt.hash)
      if (evt.to == x.address.toLowerCase()) {
        for (const a of data.result) {
          console.log("target: ", a.hash)
          if (a.hash == evt.hash && a.value != evt.value) {
            console.log(evt.hash, a.hash)
            ok = true
            console.log("ok")
            break
          }
        }
      }
      return parseInt(evt.nonce) > (x.lastNonce || 0) && ok
    })
    const indexedNewTransferEvent = {}
    newTransferEvent.map(y => {
      if (!indexedNewTransferEvent[y.nonce]) indexedNewTransferEvent[y.nonce] = []
      indexedNewTransferEvent[y.nonce].push(y)
    })

    console.log(myCache.get("targetAddress"))
    // console.log(newTransferEvent)

    for (const [key, value] of Object.entries(indexedNewTransferEvent)) {

      const inEvent = value.filter(inEvt => inEvt.to == x.address.toLowerCase())
      const inTokenName = inEvent[0]?.tokenSymbol
      const inAmount = inEvent[0]?.value / inEvent[0]?.tokenDecimal

      const outEvent = value.filter(inEvt => inEvt.from == x.address.toLowerCase())
      const outTokenName = outEvent[0]?.tokenSymbol
      const outAmount = outEvent[0]?.value / outEvent[0]?.tokenDecimal

      console.log("groups Id: ",targetGroupIds)
      for (id of targetGroupIds) {
      console.log("groups sdfsdfId: ",id)

        bot.sendMessage(
          id,
          `${x.name}\n${x.address} \nin: ${inTokenName} ${inAmount}\nout: ${outTokenName} ${outAmount}\nhttps://ftmscan.com/tx/${value[0].hash}`
        );
      }
    }
    // if(x.lastNonce>-1&&)
  })
}


async function main() {
  console.log("running...");

  myCache.set("targetAddress", targetAddressJson);

  myCache.on("expired", function (key, value) {
    console.log("cache expired");
    myCache.set("targetAddress", value);
    fs.writeFileSync("./targetAddress.json", JSON.stringify(value));
    console.log(value);
    console.log("cache updated");
  });

  bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    console.log(msg);

    fs.readFile("./groupIds.json", "utf8", (err, data) => {
      if (err) {
        console.log(err);
      } else {
        const json = JSON.parse(data);
        if (!json.includes(chatId)) {
          json.push(chatId);
          fs.writeFileSync("./groupIds.json", JSON.stringify(json));
        }
      }
    });

    if (msg.text) {
      const tokenized = msg.text.split(" ");
      if (tokenized[0] == "/add") {
        if (tokenized.length != 3) {
          bot.sendMessage(
            chatId,
            "invalid command i.e. /add ElonMusk 0x4d9361a86d038c8ada3db2457608e2275b3e08d4"
          );
        } else if (
          myCache.get("targetAddress").filter((x) => x.address == tokenized[2])
            .length != 0
        ) {
          bot.sendMessage(chatId, "address already in database");
        } else if (!web4.utils.isAddress(tokenized[2])) {
          bot.sendMessage(chatId, "invalid address");
        } else {
          const cache = myCache.get("targetAddress");
          cache.push({
            name: tokenized[1],
            address: tokenized[2],
          });
          myCache.set("targetAddress", cache);
          console.log("address: ", tokenized[2], " added!");
          bot.sendMessage(chatId, "address added!");
        }
      } else if (tokenized[0] == "/delete") {
        if (tokenized.length != 2) {
          bot.sendMessage(
            chatId,
            "invalid command i.e. /delete 0x4d9361a86d038c8ada3db2457608e2275b3e08d4"
          );
        } else if (!web4.utils.isAddress(tokenized[1])) {
          bot.sendMessage(chatId, "invalid address");
        } else {
          console.log("before");
          const cache = myCache.get("targetAddress");
          console.log("after:", cache);
          const idx = cache.findIndex((x) => x.address == tokenized[1]);
          console.log(idx);
          if (idx != -1) {
            cache.splice(idx, 1);
            myCache.set("targetAddress", cache);
            console.log("address: ", tokenized[1], " deleted!");
          }
          bot.sendMessage(chatId, "address deleted!");
        }
      }
    }

    // send a message to the chat acknowledging receipt of their message
    // bot.sendMessage(chatId, `${chatId} Received your message`);
  });

  const currentIndex = { idx: 0 }
  setInterval(async () => {
    await ftmScan(myCache.get("targetAddress"), currentIndex)
  }, 5000)
}

main();
