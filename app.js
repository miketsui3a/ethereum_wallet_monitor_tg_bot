require("dotenv").config();
const Web3 = require("web3");
const abiDecoder = require("abi-decoder");
const fs = require("fs");

const NodeCache = require("node-cache");

const myCache = new NodeCache({ stdTTL: 10 });

const erc20Abi = require("./erc20Abi.json");
const routerAbi = require("./routerAbi.json");
const targetAddressJson = require("./targetAddress.json");

const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.TG_BOT_API_KEY, { polling: true });

abiDecoder.addABI(erc20Abi);
abiDecoder.addABI(routerAbi);

async function main() {
    let web3 = new Web3(process.env.WEB3_WEBSOCKET_ENDPOINT);
    let web4 = new Web3(process.env.WEB3_HTTP_ENDPOINT);
    console.log("running...");

    myCache.set("targetAddress", targetAddressJson);

    myCache.on("expired", function (key, value) {
        console.log("cache expired");
        myCache.set("targetAddress", value);
        fs.writeFileSync("./targetAddress.json", JSON.stringify(value));
        console.log("cache updated");
        console.log(myCache.get("targetAddress"));
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
                } else if (!web3.utils.isAddress(tokenized[2])) {
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
                } else if (!web3.utils.isAddress(tokenized[1])) {
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
    web3.eth.subscribe("pendingTransactions", async (error, result) => {
        if (error) {
            console.log(error);
        } else {
            // const rst = await Promise.all([web4.eth.getTransaction(result), web4.eth.getTransactionReceipt(result)])
            // const tx = rst[0]
            // const receipt = rst[1]

            let targetAddress = myCache.get("targetAddress");

            const tx = await web4.eth.getTransaction(result);
            const receipt = await web4.eth.getTransactionReceipt(result);
            try {
                if (targetAddress.map((x) => x.address).includes(tx.from)) {
                    const target = targetAddress.filter((x) => x.address == tx.from)[0];

                    const data = abiDecoder.decodeMethod(tx.input);
                    if (receipt.status && data && data.name.includes("swap")) {
                        let logs = abiDecoder.decodeLogs(receipt.logs);
                        logs = logs.filter((log) => log.name == "Transfer");
                        console.log(tx.from);

                        const path =
                            data.params[data.params.findIndex((x) => x.name == "path")].value;
                        const inTokenContract = new web4.eth.Contract(erc20Abi, path[0]);
                        const outTokenContract = new web4.eth.Contract(
                            erc20Abi,
                            path[path.length - 1]
                        );

                        const inTokenName = await inTokenContract.methods.symbol().call();
                        const outTokenName = await outTokenContract.methods.symbol().call();

                        const inAmount =
                            inTokenName == "USDC" || inTokenName == "fUSDT"
                                ? web3.utils.fromWei(logs[0].events[2].value, "mwei")
                                : web3.utils.fromWei(logs[0].events[2].value, "ether");
                        const outAmount =
                            outTokenName == "USDC" || outTokenName == "fUSDT"
                                ? web3.utils.fromWei(
                                    logs[logs.length - 1].events[2].value,
                                    "mwei"
                                )
                                : web3.utils.fromWei(
                                    logs[logs.length - 1].events[2].value,
                                    "ether"
                                );
                        console.log("intoken: ", inTokenName, inAmount);
                        console.log("outToken: ", outTokenName, outAmount);

                        const targetGroupIds = require("./groupIds.json");

                        for (id of targetGroupIds) {
                            bot.sendMessage(
                                id,
                                `${target.name}\n${target.address} \nsell: ${inTokenName} ${inAmount}\nbuy: ${outTokenName} ${outAmount}\nhttps://ftmscan.com/tx/${result}`
                            );
                        }
                    }
                }

            } catch (e) {
                console.log(e)
            }
        }
    });
}

main();
