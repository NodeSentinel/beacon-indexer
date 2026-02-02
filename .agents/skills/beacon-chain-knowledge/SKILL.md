# Beacon Chain Knowledge Index

## Description

This skill provides knowledge regarding the beacon chain.

## The beacon chain

** Nodes and Validators**
The main participants in the Ethereum network are nodes. A node's role is to validate consensus and form the communication backbone with other nodes

**Blockchain time**

Time in Ethereum’s proof-of-stake consensus is strictly regimented. The two fundamental time units are slots and epochs, where an epoch consists of a fixed number of slots. Slots and epochs advance continuously and deterministically, regardless of network conditions.

These parameters vary by chain. For example, on Ethereum mainnet, each epoch contains 32 slots, with each slot lasting exactly 12 seconds. On Gnosis Chain, epochs consist of 16 slots, each with a duration of 5 seconds.

chain configurations can be found in this file packages/consensus-utils/src/config/chain.ts

Some relevant links where you can find more information:
https://eth2book.info/capella/part2/consensus/overview/#nodes-and-validators
https://eth2book.info/capella/part2/consensus/overview/#slots-and-epochs
https://eth2book.info/capella/part2/consensus/overview/#blocks-and-attestations
https://eth2book.info/capella/part2/consensus/overview/#slashing

**participation rhythms**

- **Attestation committees**: Validators attest **once per epoch**.
- **Sync committee**: A fixed set serves for **256 epochs**, participating in **every slot** during that period.
- **Block proposals**: Rare, random assignment. High reward when it happens.

### Tokens by chain

- **Mainnet**: Consensus rewards in ETH, Execution rewards in ETH
- **Gnosis**: Consensus rewards in GNO, Execution rewards in DAI
