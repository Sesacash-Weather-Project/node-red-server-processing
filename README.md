![Screenshot](images/telos_node_screenshot.png)

# Telos Node-Red NPM Package

Telos is a public eosio blockchain run by independent people around the world. This repository is for the development of a node-red NPM module that connects data to the blockchain.

Here you will find the javascript and HTML code for the "telos-transfer" node as well as the "telos-push" in a future version.

## Direct Usage

You can install the project and all its dependencies in your home .node-red location. This can be done with:

```
cd $HOME/.node-red
npm install node-red-contrib-telos-eosio
```

You should see a package-lock.json file and a folder called node_modules that includes eosjs libraries for interacting with the blockchain.

## Example flow usage

The example flow files require other NPM node-red packages to work properly. Install the twitter API node by doing the following:

```
cd $HOME/.node-red
npm install node-red-node-twitter
```
