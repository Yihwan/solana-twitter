import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { SolanaTwitter } from "../target/types/solana_twitter";
import * as assert from "assert";
import { bs58 } from "@project-serum/anchor/dist/cjs/utils/bytes";

describe("solana-twitter", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());
  const program = anchor.workspace.SolanaTwitter as Program<SolanaTwitter>;

  it('can send a new tweet', async () => {
    const tweet = await sendTweet(program.provider.wallet.publicKey, 'exampletopic', 'CONTENT')

    const tweetAccount = await program.account.tweet.fetch(tweet.publicKey);

    assert.equal(tweetAccount.author.toBase58(), program.provider.wallet.publicKey.toBase58());
    assert.equal(tweetAccount.topic, 'exampletopic');
    assert.equal(tweetAccount.content, 'CONTENT');
    assert.ok(tweetAccount.timestamp);
  });

  it('cannot provide a topic with more than 50 characters', async () => {
    try {
      const tweet = anchor.web3.Keypair.generate();
  
      await program.rpc.sendTweet('x'.repeat(51), 'CONTENT', {
        accounts: {
          tweet: tweet.publicKey,
          author: program.provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [tweet],
      });
    } catch({ error }) {
        assert.equal(error.errorMessage, 'The provided topic should be 50 characters long maximum.');
        return;
    }

    assert.fail('The instruction should have failed with a 51-character topic.');    
  });

  it('can send a new tweet without a topic', async () => {
    const tweet = anchor.web3.Keypair.generate();

    await program.rpc.sendTweet('', 'CONTENT', {
      accounts: {
        tweet: tweet.publicKey,
        author: program.provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [tweet],
    });

    const tweetAccount = await program.account.tweet.fetch(tweet.publicKey);

    assert.equal(tweetAccount.author.toBase58(), program.provider.wallet.publicKey.toBase58());
    assert.equal(tweetAccount.topic, '');
    assert.equal(tweetAccount.content, 'CONTENT');
    assert.ok(tweetAccount.timestamp);
  });

  it('can send a new tweet from a different author', async () => {
    const tweet = anchor.web3.Keypair.generate();

    const otherUser = anchor.web3.Keypair.generate();
    const signature = await program.provider.connection.requestAirdrop(otherUser.publicKey, 1000000000);
    await program.provider.connection.confirmTransaction(signature);

    await program.rpc.sendTweet('', 'CONTENT', {
      accounts: {
        tweet: tweet.publicKey,
        author: otherUser.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      },
      signers: [otherUser, tweet],
    });

    const tweetAccount = await program.account.tweet.fetch(tweet.publicKey);

    assert.equal(tweetAccount.author.toBase58(), otherUser.publicKey.toBase58());
    assert.equal(tweetAccount.topic, '');
    assert.equal(tweetAccount.content, 'CONTENT');
    assert.ok(tweetAccount.timestamp);
  });

  it('can fetch all tweets', async () => {
    const tweetAccounts = await program.account.tweet.all();
    assert.equal(tweetAccounts.length, 3);
  });

  it('can filter tweets by author', async () => {
    const authorPublicKey = program.provider.wallet.publicKey;
    const tweetAccounts = await program.account.tweet.all([
      {
        memcmp: {
          offset: 8,
          bytes: authorPublicKey.toBase58(),
        }
      }
    ]);

    assert.equal(tweetAccounts.length, 2);
    assert.ok(tweetAccounts.every(tweetAccount => {
        return tweetAccount.account.author.toBase58() === authorPublicKey.toBase58()
    }));
  });

  it('can filter tweets by topic', async () => {
    const tweetAccounts = await program.account.tweet.all([
        {
            memcmp: {
                offset: 8 + // Discriminator.
                    32 + // Author public key.
                    8 + // Timestamp.
                    4, // Topic string prefix.
                bytes: bs58.encode(Buffer.from('exampletopic')), 
            }
        }
    ]);    

    assert.equal(tweetAccounts.length, 1);
    assert.equal(tweetAccounts[0].account.topic, 'exampletopic');
  })

  it('author can update tweet', async () => {
    const author = program.provider.wallet.publicKey;
    const tweet = await sendTweet(author, 'web2', 'Hello World!');
    const tweetAccount = await program.account.tweet.fetch(tweet.publicKey);

    // 2. Ensure it has the right data.
    assert.equal(tweetAccount.topic, 'web2');
    assert.equal(tweetAccount.content, 'Hello World!');

    // 3. Update the Tweet.
    await program.rpc.updateTweet('solana', 'gm everyone!', {
        accounts: {
            tweet: tweet.publicKey,
            author,
        },
    });

    // 4. Ensure the updated tweet has the updated data.
    const updatedTweetAccount = await program.account.tweet.fetch(tweet.publicKey);
    assert.equal(updatedTweetAccount.topic, 'solana');
    assert.equal(updatedTweetAccount.content, 'gm everyone!');
  });

  it('cannot update someone else\'s tweet', async () => {
    // 1. Send a tweet.
    const author = program.provider.wallet.publicKey;
    const tweet = await sendTweet(author, 'solana', 'Solana is awesome!');

    try {
        // 2. Try updating the Tweet.
        await program.rpc.updateTweet('eth', 'Ethereum is awesome!', {
            accounts: {
                tweet: tweet.publicKey,
                author: anchor.web3.Keypair.generate().publicKey,
            },
        });

        // 3. Ensure updating the tweet did not succeed.
        assert.fail('We were able to update someone else\'s tweet.');
    } catch (error) {
        // 4. Ensure the tweet account kept its initial data.
        const tweetAccount = await program.account.tweet.fetch(tweet.publicKey);
        assert.equal(tweetAccount.topic, 'solana');
        assert.equal(tweetAccount.content, 'Solana is awesome!');
    }
  });

  it('can delete a tweet', async () => {
      // 1. Create a new tweet.
      const author = program.provider.wallet.publicKey;
      const tweet = await sendTweet(author, 'solana', 'gm');

      // 2. Delete the Tweet.
      await program.rpc.deleteTweet({
          accounts: {
              tweet: tweet.publicKey,
              author,
          },
      });

      // 3. Ensure fetching the tweet account returns null.
      const tweetAccount = await program.account.tweet.fetchNullable(tweet.publicKey);
      assert.ok(tweetAccount === null);
  });

  it('cannot delete someone else\'s tweet', async () => {
    // 1. Create a new tweet.
    const author = program.provider.wallet.publicKey;
    const tweet = await sendTweet(author, 'solana', 'gm');

    // 2. Try to delete the Tweet from a different author.
    try {
        await program.rpc.deleteTweet({
            accounts: {
                tweet: tweet.publicKey,
                author: anchor.web3.Keypair.generate().publicKey,
            },
        });
        assert.fail('We were able to delete someone else\'s tweet.');
    } catch (error) {
        // 3. Ensure the tweet account still exists with the right data.
        const tweetAccount = await program.account.tweet.fetch(tweet.publicKey);
        assert.equal(tweetAccount.topic, 'solana');
        assert.equal(tweetAccount.content, 'gm');
    }
  });

  const sendTweet = async (author, topic, content) => {
    const tweet = anchor.web3.Keypair.generate();
    await program.rpc.sendTweet(topic, content, {
        accounts: {
            tweet: tweet.publicKey,
            author,
            systemProgram: anchor.web3.SystemProgram.programId,
        },
        signers: [tweet],
    });

    return tweet
  }
});
