# Introduction to Merkle Tree

A **Merkle Tree** is a data structure used primarily in computer science and cryptography to efficiently and securely verify the integrity and consistency of large datasets. It is a binary tree where the leaves store cryptographic hashes of data blocks, and each non-leaf node contains a hash of its child nodes.

![alt text](https://raw.githubusercontent.com/poridhiEng/lab-asset/refs/heads/main/Merkle%20Tree%20labs/lab%2001/images/image-4.png)


## Concepts of a Merkle Tree

1. **Hashing**:
   - A Merkle Tree relies on cryptographic hash functions (e.g., SHA-256) to create fixed-length outputs (hashes) from input data.
   - Hashes are unique to the input data, so even a small change in the data results in a completely different hash.

   ![alt text](https://raw.githubusercontent.com/poridhiEng/lab-asset/refs/heads/main/Merkle%20Tree%20labs/lab%2001/images/image-1.png)

2. **Leaf Nodes**:
   - The bottom level of the tree consists of leaf nodes, each containing a hash of a data block (e.g., a transaction in a blockchain or a file chunk).
   - Example: If you have four data blocks (D1, D2, D3, D4), their hashes (H1 = hash(D1), H2 = hash(D2), etc.) form the leaf nodes.

3. **Non-Leaf Nodes**:
   - Each parent node is created by hashing the concatenated hashes of its child nodes.
   - Example: For leaf nodes with hashes H1 and H2, the parent node’s hash is H12 = hash(H1 + H2).

4. **Root Node (Merkle Root)**:
   - The topmost node of the tree, known as the Merkle Root, is a single hash that represents all the data in the tree.
   - The Merkle Root is a compact way to summarize the entire dataset.

5. **Binary Structure**:
   - Merkle Trees are typically binary, meaning each parent node has exactly two children (though variations exist).
   - If the number of data blocks is odd, the last hash may be duplicated to maintain the binary structure.

## How a Merkle Tree Works

To construct a Merkle Tree, we need to follow these steps:

1. Divide the dataset into smaller blocks (e.g., transactions or file chunks).
2. Compute the hash of each block to create leaf nodes.
3. Pair the hashes and compute the hash of each pair to form the next level of the tree.
4. Repeat until a single hash (Merkle Root) remains.

   Example:

   ```
   Data Blocks: D1, D2, D3, D4
   Leaf Hashes: H1 = hash(D1), H2 = hash(D2), H3 = hash(D3), H4 = hash(D4)
   Parent Hashes: H12 = hash(H1 + H2), H34 = hash(H3 + H4)
   Merkle Root: HR = hash(H12 + H34)
   ```


## Merkle Tree Construction Algorithm

The algorithm constructs a Merkle Tree from a list of data blocks (e.g., transactions or file chunks) using a cryptographic hash function (e.g., SHA-256). Here’s how it works:

### Steps

1. **Prepare Data Blocks**
   
   Start with a list of data blocks (e.g., transactions, file chunks, or any data segments). Ensure the data blocks are in a consistent format for hashing.

   ![alt text](https://raw.githubusercontent.com/poridhiEng/lab-asset/refs/heads/main/Merkle%20Tree%20labs/lab%2001/images/image-5.png)

2. **Hash the Data Blocks**

   Compute the cryptographic hash (e.g., SHA-256) of each data block to create the **leaf nodes** of the tree. Store these hashes in a list.

   ![alt text](https://raw.githubusercontent.com/poridhiEng/lab-asset/refs/heads/main/Merkle%20Tree%20labs/lab%2001/images/image-6.png)

3. **Handle Odd Number of Hashes**

   If the number of leaf hashes is odd, duplicate the last hash to ensure an even number of nodes for pairing.

4. **Build the Tree Bottom-Up**

   Pair the leaf hashes and compute the hash of each pair to form the **parent nodes**. If there’s only one hash left at any level, it becomes the parent node (or is duplicated if needed). Repeat this process, creating higher levels of the tree by hashing pairs of nodes, until a single hash remains: the **Merkle Root**.

   ![alt text](https://raw.githubusercontent.com/poridhiEng/lab-asset/refs/heads/main/Merkle%20Tree%20labs/lab%2001/images/image-7.png)

5. **Output the Merkle Root**

   The Merkle Root is a single hash that summarizes all the data blocks. Optionally, store the entire tree (or parts of it) for verification purposes.

   ![alt text](https://raw.githubusercontent.com/poridhiEng/lab-asset/refs/heads/main/Merkle%20Tree%20labs/lab%2001/images/image-8.png)

### Pseudocode

```bash
function buildMerkleTree(dataBlocks):
    if dataBlocks is empty:
        return null

    # Step 1: Hash all data blocks to create leaf nodes
    leafHashes = []
    for each block in dataBlocks:
        hash = SHA256(block)
        leafHashes.append(hash)

    # Step 2: Build the tree iteratively
    currentLevel = leafHashes
    while length(currentLevel) > 1:
        nextLevel = []
        for i from 0 to length(currentLevel) step 2:
            if i + 1 < length(currentLevel):
                # Pair two hashes and compute parent hash
                parentHash = SHA256(currentLevel[i] + currentLevel[i+1])
            else:
                # Duplicate last hash if odd number of hashes
                parentHash = SHA256(currentLevel[i] + currentLevel[i])
            nextLevel.append(parentHash)
        currentLevel = nextLevel

    # Step 3: Return the Merkle Root
    return currentLevel[0]
```

## Explanation of the Algorithm

1. **Input**

   A list of data blocks (e.g., `[D1, D2, D3, D4]`). A cryptographic hash function (e.g., SHA-256).

2. **Leaf Node Creation**

   For each data block `Di`, compute `Hi = SHA256(Di)`. Example: For blocks `[D1, D2, D3, D4]`, compute `[H1, H2, H3, H4]`.

3. **Pairing and Hashing**

   Pair consecutive hashes: `(H1, H2)` and `(H3, H4)`. Compute parent hashes: `H12 = SHA256(H1 + H2)` and `H34 = SHA256(H3 + H4)`. If the number of hashes is odd, duplicate the last hash: e.g., for `[H1, H2, H3]`, pair `(H1, H2)` and `(H3, H3)`.

4. **Iterate Up the Tree**

   Use the parent hashes `[H12, H34]` as the next level. Pair and hash again: `HR = SHA256(H12 + H34)`. Continue until only one hash (the Merkle Root) remains.

5. **Edge Cases**

   - Empty Input: Return null or an error.
   - Single Block: The Merkle Root is simply the hash of that block.
   - Odd Number of Hashes: Duplicate the last hash to maintain the binary structure.

6. **Output**

   The Merkle Root, a single hash representing all data blocks. Optionally, retain the tree structure (hashes at each level) for verification or proof generation.

## NodeJS Implementation

### Project Structure

```
merkle-cli/
├── merkle.js           # Merkle tree logic
├── cli.js              # CLI entry point
├── utils.js            # SHA-256 hashing helper
├── package.json        # NPM config
```

### 1. `utils.js` – Simple SHA-256 hashing

```js
const crypto = require('crypto');

function hashData(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = { hashData };
```

### 2. `merkle.js` – Tree construction only

```js
const { hashData } = require('./utils');

function buildMerkleTree(dataBlocks) {
  if (!dataBlocks.length) return { root: null, levels: [] };

  let nodes = dataBlocks.map(block => ({
    hash: hashData(block),
    data: block
  }));

  const levels = [nodes];

  while (nodes.length > 1) {
    const nextLevel = [];

    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      const right = nodes[i + 1] || nodes[i]; // duplicate last if odd
      const combinedHash = hashData(left.hash + right.hash);
      nextLevel.push({ hash: combinedHash, left, right });
    }

    nodes = nextLevel;
    levels.push(nodes);
  }

  return { root: nodes[0], levels };
}

module.exports = { buildMerkleTree };
```

### 3. `cli.js` – CLI interface

```js
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const { buildMerkleTree } = require('./merkle');

program
  .name('merkle-cli')
  .description('Merkle Tree CLI Tool')
  .option('--input-file <path>', 'File with data blocks (one per line)')
  .option('--output-file <path>', 'Save Merkle tree JSON to file')
  .option('--pretty', 'Pretty-print JSON output')
  .argument('[data...]', 'Data blocks to build the tree')
  .parse();

const opts = program.opts();
let dataBlocks = program.args;

if (opts.inputFile) {
  const filePath = path.resolve(opts.inputFile);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found at ${filePath}`);
    process.exit(1);
  }

  const fileData = fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  dataBlocks = [...dataBlocks, ...fileData];
}

if (!dataBlocks.length) {
  console.error('Error: No data blocks provided.');
  process.exit(1);
}

// Build the Merkle Tree
const { root } = buildMerkleTree(dataBlocks);

if (!root) {
  console.error('Error: Merkle Tree could not be built.');
  process.exit(1);
}

// Output JSON
const json = JSON.stringify(root, null, opts.pretty ? 2 : 0);

if (opts.outputFile) {
  fs.writeFileSync(opts.outputFile, json);
  console.log(`Merkle tree saved to ${opts.outputFile}`);
} else {
  console.log('Merkle Tree JSON:');
  console.log(json);
}

console.log(`\nMerkle Root: ${root.hash}`);
```

### 4. `package.json`

```json
{
  "name": "merkletree-nodejs",
  "version": "1.0.0",
  "description": "",
  "main": "cli.js",
  "bin": {
    "merkle-cli": "./cli.js"
  },
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "commander": "^14.0.0"
  }
}
```

Install dependencies:

```bash
npm i
```

Make CLI executable:

```bash
chmod +x cli.js
```

### Output

Run the following command to build the Merkle Tree:

```bash
./cli.js --input-file=input.txt --pretty --output-file=tree.json
```

> Make sure to create a file called `input.txt` with the data blocks in it.

![alt text](https://raw.githubusercontent.com/poridhiEng/lab-asset/refs/heads/main/Merkle%20Tree%20labs/lab%2001/images/image-12.png)

You can also run the following command to build the Merkle Tree by passing the data blocks as command line arguments:

```bash
./cli.js Data1 Data2 Data3 Data4 --pretty --output-file=tree.json
```

![alt text](https://raw.githubusercontent.com/poridhiEng/lab-asset/refs/heads/main/Merkle%20Tree%20labs/lab%2001/images/image-11.png)

### **Conclusion**

Merkle Trees are a powerful and versatile data structure that underpin many modern technologies, particularly in blockchain, distributed systems, and data integrity verification. Their ability to provide efficient, secure, and scalable proofs of inclusion and consistency makes them invaluable in scenarios where trust and performance are critical.