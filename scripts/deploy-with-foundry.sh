#!/bin/bash
set -e

RPC_URL="${XLAYER_TESTNET_RPC:-https://testrpc.xlayer.tech}"
PRIVATE_KEY="$PRIVATE_KEY"

if [ -z "$PRIVATE_KEY" ]; then
  echo "PRIVATE_KEY not set"
  exit 1
fi

FORGE=/Users/davirian/.config/.foundry/bin/forge
CAST=/Users/davirian/.config/.foundry/bin/cast

echo "Deploying AaveScoreModule..."
DEPLOYER=$($CAST wallet address "$PRIVATE_KEY")
AAVE_MODULE=$($FORGE create contracts/modules/AaveScoreModule.sol:AaveScoreModule --broadcast --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --constructor-args "${AAVE_POOL}" "$DEPLOYER" | grep "Deployed to:" | awk '{print $3}')
echo "AaveScoreModule: $AAVE_MODULE"

echo "Deploying UniswapScoreModule..."
UNI_MODULE=$($FORGE create contracts/modules/UniswapScoreModule.sol:UniswapScoreModule --broadcast --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --constructor-args "$DEPLOYER" | grep "Deployed to:" | awk '{print $3}')
echo "UniswapScoreModule: $UNI_MODULE"

echo "Deploying BaseActivityModule..."
BASE_MODULE=$($FORGE create contracts/modules/BaseActivityModule.sol:BaseActivityModule --broadcast --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --constructor-args "$DEPLOYER" | grep "Deployed to:" | awk '{print $3}')
echo "BaseActivityModule: $BASE_MODULE"

echo "Deploying AgentRepValidator..."
VALIDATOR=$($FORGE create contracts/AgentRepValidator.sol:AgentRepValidator --broadcast --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --constructor-args "${IDENTITY_REGISTRY}" "${REPUTATION_REGISTRY}" "${VALIDATION_REGISTRY:-0x0000000000000000000000000000000000000000}" "$DEPLOYER" | grep "Deployed to:" | awk '{print $3}')
echo "AgentRepValidator: $VALIDATOR"

echo ""
echo "Registering modules to Validator..."
$CAST send --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" "$VALIDATOR" "registerModule(address,uint256)" "$AAVE_MODULE" 3500
$CAST send --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" "$VALIDATOR" "registerModule(address,uint256)" "$UNI_MODULE" 4000
$CAST send --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" "$VALIDATOR" "registerModule(address,uint256)" "$BASE_MODULE" 2500

echo ""
echo "Setting keeper to deployer on Uniswap and Base modules..."
$CAST send --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" "$UNI_MODULE" "setKeeper(address,bool)" "$DEPLOYER" true
$CAST send --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" "$BASE_MODULE" "setKeeper(address,bool)" "$DEPLOYER" true

echo ""
echo "=== Deployment Summary ==="
echo "AaveScoreModule=$AAVE_MODULE"
echo "UniswapScoreModule=$UNI_MODULE"
echo "BaseActivityModule=$BASE_MODULE"
echo "AgentRepValidator=$VALIDATOR"
echo "Deployer/Keeper=$DEPLOYER"
