import { ArconnectSigner } from "arbundles";
import BigNumber from "bignumber.js";
import crypto from "crypto";
import type { CurrencyConfig, Tx } from "../../common/types";
import base64url from "base64url";
import BaseNodeCurrency from "../currency";
import { Arweave } from "../utils";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type * as _ from "arconnect";

export default class ArweaveConfig extends BaseNodeCurrency {
  protected declare providerInstance: Arweave;
  opts?: { provider?: "arconnect" | "arweave.app"; network?: string };
  protected declare wallet: Window["arweaveWallet"];
  protected signerInstance: ArconnectSigner;
  constructor(config: CurrencyConfig) {
    super(config);
    this.base = ["winston", 1e12];
    this.needsFee = true;
  }

  private async getProvider(): Promise<Arweave> {
    if (!this.providerInstance) {
      const purl = new URL(this.providerUrl ?? "https://arweave.net");
      let config;
      try {
        config = this.wallet.getArweaveConfig();
      } catch (e) {}
      this.providerInstance = Arweave.init(
        config ?? {
          host: purl.hostname,
          protocol: purl.protocol.replaceAll(":", "").replaceAll("/", ""),
          port: purl.port,
          network: this?.opts?.network,
        },
      );
    }
    return this.providerInstance;
  }

  async getTx(txId: string): Promise<Tx> {
    const arweave = await this.getProvider();
    const txs = await arweave.transactions.getStatus(txId);
    let tx;
    if (txs.status === 200) {
      tx = await arweave.transactions.get(txId);
    }
    const confirmed = txs.status !== 202 && (txs.confirmed?.number_of_confirmations ?? 0) >= this.minConfirm;
    let owner;
    if (tx?.owner) {
      owner = this.ownerToAddress(tx.owner);
    }
    return {
      from: owner ?? undefined,
      to: tx?.target ?? undefined,
      amount: new BigNumber(tx?.quantity ?? 0),
      pending: txs.status === 202,
      confirmed,
    };
  }

  ownerToAddress(owner: any): string {
    return Arweave.utils.bufferTob64Url(
      crypto
        .createHash("sha256")
        .update(Arweave.utils.b64UrlToBuffer(Buffer.isBuffer(owner) ? base64url(owner) : owner))
        .digest(),
    );
  }

  async sign(data: Uint8Array): Promise<Uint8Array> {
    return this.getSigner().sign(data);
  }

  getSigner(): ArconnectSigner {
    if (this.signerInstance) return this.signerInstance;
    switch (this?.opts?.provider ?? "arconnect") {
      case "arconnect":
        this.signerInstance = new ArconnectSigner(this.wallet);
    }
    return this.signerInstance;
  }

  async verify(pub: any, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
    if (Buffer.isBuffer(pub)) {
      pub = pub.toString();
    }
    return Arweave.crypto.verify(pub, data, signature);
  }

  async getCurrentHeight(): Promise<BigNumber> {
    return (await this.getProvider()).network.getInfo().then((r) => new BigNumber(r.height));
  }

  async getFee(amount: BigNumber.Value, to?: string): Promise<BigNumber> {
    return new BigNumber(await (await this.getProvider()).transactions.getPrice(new BigNumber(amount).toNumber(), to)).integerValue(
      BigNumber.ROUND_CEIL,
    );
  }

  async sendTx(data: any): Promise<any> {
    return await (await this.getProvider()).transactions.post(data);
  }

  async createTx(amount: BigNumber.Value, to: string, fee?: string): Promise<{ txId: string | undefined; tx: any }> {
    const arweave = await this.getProvider();
    const tx = await this.wallet.sign(await arweave.createTransaction({ quantity: new BigNumber(amount).toString(), reward: fee, target: to }));
    return { txId: tx.id, tx };
  }

  async getPublicKey(): Promise<string> {
    const signer = this.getSigner();
    await signer.setPublicKey();
    return Arweave.utils.bufferTob64Url(signer.publicKey);
  }
}
