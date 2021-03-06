const { Api, JsonRpc, RpcError, Serialize } = require('eosjs');
const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');      // development only
const ecc = require('eosjs-ecc');

const fetch = require('node-fetch');                                    // node only; not needed in browsers
const { TextEncoder, TextDecoder } = require('util');                   // node only; native TextEncoder/Decoder

const fs = require('fs');
var _ = require('lodash');

const trans = require('./lib/transaction_modules.js');


module.exports = function(RED) {
    function TelosPushNode(config) {

        RED.nodes.createNode(this,config);
        var node = this;

        //node.blockchain = config.blockchain; // Don't need. Chain ID should be enough
        node.chainid = config.chainid;
        if (config.endpoint === "other") {
            node.endpoint = config.customendpoint;
        } else {
            node.endpoint = config.endpoint;
        }
        node.privkey = fs.readFileSync(config.privkey, 'utf8').trim();
        node.pubkey = ecc.privateToPublic(node.privkey);

        node.inputtype = config.inputtype;
        node.subaccount = config.name;

        // Initialize eojs API
        const signatureProvider = new JsSignatureProvider([node.privkey]);
        const rpc = new JsonRpc(node.endpoint, { fetch });
        const api = new Api({ rpc, signatureProvider, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

        let connect = true;

        (async () => {

            // Test that chain ID is correct
            /*
            try {
                // UNCOMMENT FOLLOWING 2 LINES
                const info = await rpc.get_info(); //get information from http endpoint
                if (info.chain_id === node.chainid) { // check that chain id matches endpoint response
                    console.log("Blockchain endpoint connection successfull.");
                } else {
                    console.log("Are you sure you are on the right blockchain?");
                    console.log("The http endpoint you provided doesn't match the chain ID");
                    console.log("Your provided chain ID: " + node.chainid);
                    console.log("RPC response: " + info.chain_id);
                    connect = false;
                }
            } catch (e) {
                console.log(e); // Print any timeout errors
            }
             */

            let accountInfo, accountAbi, repoAbi;

            // Check that account exists and fits private key
            try {
                if (connect === false) {throw ""};

                // Get account info
                accountInfo = await rpc.get_account(node.subaccount);

                // Loop through the various permissions
                for (var i=0; i < accountInfo.permissions.length; i++){
                    if (accountInfo.permissions[i].perm_name === 'active')
                    {
                        const authKeys = accountInfo.permissions[i].required_auth.keys;
                        if (authKeys.length > 1 || authKeys[0].key !== node.pubkey) {
                           console.log("The account key you provided doesn't match the 'active' permission");
                           return;
                        }
                    }
                }
            } catch (e) {
                //if (e.json.error.details[0].message.includes("unknown key"))
                if (e instanceof RpcError)
                {
                    console.log("The provided account name "+node.subaccount+" doesn't seem to exist.");
                    connect = false;
                }

            }

            // Compare account's ABI to the one found in the repo
            //   Deploy nodered contract if necessary
            try {
                if (connect === false) {throw ""};

                accountAbi = await rpc.get_abi(node.subaccount);

                if ("abi" in accountAbi) { // Contract exists

                    // Read the ABI file found inside the repository
                    repoAbi = JSON.parse(fs.readFileSync('telos-push/contract_code/wxlaunches.abi', 'utf8'));

                    // Check if ABI's properties are different from the repository's ABI
                    if (!_.isEqual(accountAbi.abi.actions, repoAbi.actions) ||
                        !_.isEqual(accountAbi.abi.tables, repoAbi.tables) ||
                        !_.isEqual(accountAbi.abi.structs, repoAbi.structs)
                    ) {
                        // Contract is not one we recognize.
                        console.log("A contract with a different ABI already exists on the account.");
                        console.log("Please input a different account name.");
                        connect = false;
                    } else { /* The contract has the right ABI */}

                } else { // There is no contract applied yet

                    let failRamBuy;

                    // Check if we have enough RAM to apply a contract on the account
                    while (accountInfo.ram_quota - accountInfo.ram_usage < 100000) {
                        failRamBuy = await trans.buy_ram("noderedtelos", node.subaccount, 100000, api)
                        if ( failRamBuy !== 0) {
                            console.log("Parent TLOS balance too low for contract deployment");
                            connect = false;
                        } else {
                            accountInfo = await rpc.get_account(node.subaccount);
                        }
                    }

                    if (connect === false) {throw ""};

                    // Convert ABI and WASM into hex strings
                    const wasmFilePath = 'telos-push/contract_code/wxlaunches.wasm';
                    const wasmHexString = fs.readFileSync(wasmFilePath).toString('hex');
                    const abiFilePath = 'telos-push/contract_code/wxlaunches.abi';
                    const buffer = new Serialize.SerialBuffer({
                        textEncoder: api.textEncoder,
                        textDecoder: api.textDecoder,
                    });

                    let abiJSON = JSON.parse(fs.readFileSync(abiFilePath, 'utf8'));
                    const abiDefinitions = api.abiTypes.get('abi_def');
                    abiJSON = abiDefinitions.fields.reduce(
                        (acc, { name: fieldName }) =>
                            Object.assign(acc, { [fieldName]: acc[fieldName] || [] }),
                        abiJSON
                    );
                    abiDefinitions.serialize(buffer, abiJSON);
                    const serializedAbiHexString = Buffer.from(buffer.asUint8Array()).toString('hex');

                    trans.deploy_contract(node.subaccount, wasmHexString, serializedAbiHexString, api);

                }
            } catch (e) {
                if (e instanceof RpcError) // Should specify error due to 'unknown key'
                {
                    console.log("Unexpected RPC error when checking account's contract.");
                    connect = false;
                }
            }

            if (connect){
                console.log("Node looks good. Connecting node to injection.");
                // Function that runs every time data is injected
                node.on('input', function(msg){

                    let actionArgs = [];
                    let actionName = "addobs";

                    /*
                    // Check if msg.action was passed
                    if (msg.hasOwnProperty('action')) {
                        actionName = msg.action;
                    } else {
                        actionName = "addobs"
                    }
                    */

                    // Get a list of all the action's arguments
                    for (var i=0; i < repoAbi.structs.length; i++) {
                        if (repoAbi.structs[i].name === actionName) {
                            for (var j=0; j < repoAbi.structs[i].fields.length; j++) {
                                actionArgs.push(repoAbi.structs[i].fields[j].name);
                            }
                            break; // Break out of loop for speed
                        }
                    }

                    // Check the action's arguments for matching items in msg.payload
                    if (actionArgs.length > 0) {
                        // Check that each payload key corresponds to an action argument
                        for (var arg of actionArgs) {
                            if (!msg.payload.hasOwnProperty(arg)) {
                                console.log("Action argument "+arg+" is not fulfilled by payload.");
                            }
                        }
                    } else {
                        console.log("The action name doesn't exist or have any parameters.");
                        return;
                    }

                    // UNCOMMENT when ready to add iot data to eosio table
                    trans.payload_to_blockchain(node.subaccount, actionName, msg.payload, api);
                    node.send(msg); // continue sending message through to outputs if necessary
                });
            }

        })(); // End of async
    }                       // end TelosTransactNode definition

    RED.nodes.registerType("telos-push",TelosPushNode);
};
