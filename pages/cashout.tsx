"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { ConnectButton } from "@rainbow-me/rainbowkit"
import { erc20Abi, formatUnits, getAddress, parseUnits } from "viem"
import {
  useAccount,
  useBalance,
  usePublicClient,
  useWalletClient,
} from "wagmi"
import { base } from "wagmi/chains"
import axios from "axios"

// ====== CONSTANTS (Base) ======
const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
const CBBTC = getAddress("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf")
const USDC_DECIMALS = 6
$1const GAS_BUFFER_WEI = parseUnits("0.0002", 18) // ~0.0002 ETH preserved for gas

// --- Detector de mobile (iframes não funcionam com provider em iOS/Android) ---
const isMobile = typeof navigator !== "undefined" ? /iphone|ipad|ipod|android/i.test(navigator.userAgent) : false

// Leave a tiny gas buffer so the wallet isn't bricked with 0 ETH

// Leave a tiny gas buffer so the wallet isn't bricked with 0 ETH
// ====== Types ======
export type ZeroExQuote = {
  to: `0x${string}`
  data: `0x${string}`
  allowanceTarget?: `0x${string}`
  buyAmount: string // in buy token wei
  sellAmount: string // in sell token wei
  value?: string // OPTIONAL msg.value (for native ETH sells)
}

// ====== Helpers ======
async function get0xQuoteBase(opts: {
  sellToken: string
  buyToken: string
  sellAmountWei: string
  takerAddress: string
  slippagePerc?: number
}): Promise<ZeroExQuote> {
  const { sellToken, buyToken, sellAmountWei, takerAddress, slippagePerc = 0.005 } = opts
  const { data } = await axios.get("https://base.api.0x.org/swap/v1/quote", {
    params: {
      sellToken,
      buyToken,
      sellAmount: sellAmountWei,
      takerAddress,
      slippagePercentage: slippagePerc.toString(),
      enableSlippageProtection: true,
    },
  })
  return {
    to: data.to,
    data: data.data,
    allowanceTarget: data.allowanceTarget || data.spender,
    buyAmount: data.buyAmount,
    sellAmount: data.sellAmount,
    value: data.value,
  }
}

async function ensureAllowance(params: {
  publicClient: ReturnType<typeof usePublicClient> extends infer T ? T : any
  walletClient: NonNullable<ReturnType<typeof useWalletClient>["data"]>
  owner: `0x${string}`
  token: `0x${string}`
  spender: `0x${string}`
  amountWei: bigint
}): Promise<void> {
  const { publicClient, walletClient, owner, token, spender, amountWei } = params

  const current: bigint = (await publicClient!.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint

  if (current >= amountWei) return

  // Approve using raw sendTransaction (avoids TS mismatch with writeContract)
  const { encodeFunctionData } = await import("viem")
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amountWei],
  })

  const hash = await walletClient.sendTransaction({
    account: owner,
    to: token,
    data,
    chain: base,
    value: 0n,
  })
  await publicClient!.waitForTransactionReceipt({ hash })
} = params

  const current: bigint = (await publicClient!.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  })) as bigint

  if (current >= amountWei) return

  // Approve exact amount (or you can set MaxUint256 if you prefer)
  const hash = await walletClient.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amountWei],
    chain: base,
  })
  await publicClient!.waitForTransactionReceipt({ hash })
}

// ====== PAGE ======
export default function Page() {
  const { address, isConnected, chainId } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  // balances (live hooks for UI)
  const { data: ethBal } = useBalance({ address, chainId: base.id })
  const { data: cbBtcBal } = useBalance({ address, token: CBBTC, chainId: base.id })
  const { data: usdcBal } = useBalance({ address, token: USDC, chainId: base.id })

  const [busy, setBusy] = useState(false)
const [log, setLog] = useState<string>("")
const [slippage, setSlippage] = useState<number>(0.005) // 0.5%

// CoW widgets state
const [showCow, setShowCow] = useState(false)
const [ethSellWeiForCow, setEthSellWeiForCow] = useState<bigint>(0n)
const [cbBtcWeiForCow, setCbBtcWeiForCow] = useState<bigint>(0n)

const cowUrlEth = useMemo(() => {
  if (!ethSellWeiForCow) return ""
  const sellAmount = formatUnits(ethSellWeiForCow, 18) // ETH decimals
  return `https://swap.cow.fi/#/8453/swap/ETH/${USDC}?sellAmount=${sellAmount}&theme=dark&hideNetworkSelector=true`
}, [ethSellWeiForCow])

const cowUrlCbBtc = useMemo(() => {
  if (!cbBtcWeiForCow) return ""
  const sellAmount = formatUnits(cbBtcWeiForCow, CBBTC_DECIMALS)
  return `https://swap.cow.fi/#/8453/swap/${CBBTC}/${USDC}?sellAmount=${sellAmount}&theme=dark&hideNetworkSelector=true`
}, [cbBtcWeiForCow])

  function append(message: string) {
    setLog((p) => (p ? `${p}\n${message}` : message))
  }

  const canOperate = isConnected && chainId === base.id && publicClient && walletClient

  // ====== MAIN ACTION ======
  async function cashoutAllToUSDC() {
    try {
      if (!address || !publicClient || !walletClient) return
      if (chainId !== base.id) throw new Error("Troque a rede para Base.")
      setBusy(true)
      setLog("")

      // --- 1) Read on-chain balances precisely ---
      append("Lendo saldos on-chain…")

      const [nativeEthWei, cbBtcWei] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.readContract({
          address: CBBTC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }) as Promise<bigint>,
      ])

      // --- 2) Prepare ETH sell (leave small gas buffer) ---
      let ethSellWei = nativeEthWei
      if (ethSellWei > GAS_BUFFER_WEI) ethSellWei = ethSellWei - GAS_BUFFER_WEI
      else ethSellWei = 0n

      // --- 3) If have cbBTC, quote & approve, then swap ---
      if (cbBtcWei > 0n) {
        append(`cbBTC a vender: ${formatUnits(cbBtcWei, CBBTC_DECIMALS)} cbBTC`)
        const q = await get0xQuoteBase({
          sellToken: CBBTC,
          buyToken: USDC,
          sellAmountWei: cbBtcWei.toString(),
          takerAddress: address,
          slippagePerc: slippage,
        })
        if (!q.allowanceTarget) throw new Error("Spender do 0x não informado.")
        append("Aprovando cbBTC para o 0x…")
        await ensureAllowance({
          publicClient,
          walletClient,
          owner: address,
          token: CBBTC,
          spender: q.allowanceTarget,
          amountWei: cbBtcWei,
        })
        append("Executando swap cbBTC → USDC…")
        const txHash = await walletClient.sendTransaction({
          account: address,
          to: q.to,
          data: q.data,
          chain: base,
          value: 0n,
        })
        append(`Swap cbBTC enviado: ${txHash}`)
        await publicClient.waitForTransactionReceipt({ hash: txHash })
        append("✅ cbBTC → USDC concluído.")
      } else {
        append("Sem cbBTC para vender.")
      }

      // --- 4) If have ETH (after buffer), quote & swap ---
      if (ethSellWei > 0n) {
        append(`ETH a vender: ${formatUnits(ethSellWei, 18)} ETH (buffer de gás mantido)`) 
        const q = await get0xQuoteBase({
          sellToken: "ETH",
          buyToken: USDC,
          sellAmountWei: ethSellWei.toString(),
          takerAddress: address,
          slippagePerc: slippage,
        })
        const txHash = await walletClient.sendTransaction({
          account: address,
          to: q.to,
          data: q.data,
          chain: base,
          value: q.value ? BigInt(q.value) : BigInt(q.sellAmount),
        })
        append(`Swap ETH enviado: ${txHash}`)
        await publicClient.waitForTransactionReceipt({ hash: txHash })
        append("✅ ETH → USDC concluído.")
      } else {
        append("Sem ETH líquido (após buffer) para vender.")
      }

      append("Pronto! Verifique o saldo de USDC abaixo.")
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || String(e)
      append(`❌ Erro: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  // ====== CoW first (widgets) ======
  async function prepareCowWidgets() {
    try {
      if (!address || !publicClient) return
      if (chainId !== base.id) throw new Error("Troque a rede para Base.")
      setBusy(true)
      setShowCow(false)
      append("Lendo saldos para CoW…")

      const [nativeEthWei, cbBtcWei] = await Promise.all([
        publicClient.getBalance({ address }),
        publicClient.readContract({
          address: CBBTC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        }) as Promise<bigint>,
      ])

      let ethForCow = nativeEthWei
      if (ethForCow > GAS_BUFFER_WEI) ethForCow = ethForCow - GAS_BUFFER_WEI
      else ethForCow = 0n

      setEthSellWeiForCow(ethForCow)
      setCbBtcWeiForCow(cbBtcWei)

      append(
        `CoW pronto. ETH: ${formatUnits(ethForCow, 18)} | cbBTC: ${formatUnits(cbBtcWei, CBBTC_DECIMALS)}`
      )
      setShowCow(true)
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || String(e)
      append(`❌ Erro: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  // ====== UI ======
  return (
    <main
      style={{
        maxWidth: 920,
        margin: "40px auto",
        padding: 16,
        textAlign: "center",
        background: "#000",
        color: "#fff",
        borderRadius: 12,
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <Image src="/logo-vamos.png" alt="Vamos Pra Crypto" width={140} height={140} priority />
      </div>

      <h1 style={{ color: "#60A5FA", fontWeight: 800, fontSize: 28 }}>Cashout total → USDC (Base)</h1>
      <p style={{ opacity: 0.8, marginTop: 6, marginBottom: 14 }}>
        Converte automaticamente <strong>cbBTC</strong> e <strong>ETH</strong> para <strong>USDC</strong> via 0x API.
        Um pequeno buffer de gás é preservado.
      </p>

      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
        <ConnectButton />
      </div>

      {isConnected && chainId !== base.id && (
        <p style={{ color: "#FBBF24" }}>Conecte na rede <strong>Base</strong> para continuar.</p>
      )}

      <section
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          marginTop: 16,
        }}
      >
        <div style={{ background: "#0b0b0b", padding: 12, borderRadius: 10 }}>
          <div style={{ opacity: 0.8, fontSize: 12 }}>Saldo USDC</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {usdcBal ? `${usdcBal.formatted} ${usdcBal.symbol}` : "-"}
          </div>
        </div>
        <div style={{ background: "#0b0b0b", padding: 12, borderRadius: 10 }}>
          <div style={{ opacity: 0.8, fontSize: 12 }}>Saldo cbBTC</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {cbBtcBal ? `${cbBtcBal.formatted} cbBTC` : "-"}
          </div>
        </div>
        <div style={{ background: "#0b0b0b", padding: 12, borderRadius: 10 }}>
          <div style={{ opacity: 0.8, fontSize: 12 }}>Saldo ETH</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {ethBal ? `${ethBal.formatted} ETH` : "-"}
          </div>
        </div>
      </section>

      <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Slippage (%):
          <input
            type="number"
            step="0.1"
            min="0"
            value={(slippage * 100).toString()}
            onChange={(e) => setSlippage(Math.max(0, Number(e.target.value)) / 100)}
            style={{ width: 90, padding: 8, borderRadius: 8, border: "1px solid #333", background: "#0b0b0b", color: "#fff" }}
          />
        </label>

        <button
          onClick={prepareCowWidgets}
          disabled={!canOperate || busy}
          style={{
            padding: "10px 16px",
            fontWeight: 800,
            borderRadius: 10,
            background: busy ? "#374151" : "#1f2937",
            color: "#fff",
            border: "1px solid #374151",
            cursor: canOperate && !busy ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Preparando…" : "CoW primeiro (widgets)"}
        </button>

        <button
          onClick={cashoutAllToUSDC}
          disabled={!canOperate || busy}
          style={{
            padding: "10px 16px",
            fontWeight: 800,
            borderRadius: 10,
            background: busy ? "#374151" : "#16a34a",
            color: "#fff",
            border: "none",
            cursor: canOperate && !busy ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Executando…" : "Cashout total → USDC (fallback 0x)"}
        </button>
      </div>

      {showCow && (
        <section style={{ marginTop: 18 }}>
          <h3 style={{ color: "#38bdf8" }}>CoW — cbBTC → USDC</h3>
          {cbBtcWeiForCow > 0n ? (
            isMobile ? (
              <a
                href={cowUrlCbBtc}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-block", padding: 12, borderRadius: 10, background: "#1f2937", color: "#fff", textDecoration: "none", marginBottom: 12 }}
              >
                Abrir na CoW (nova aba)
              </a>
            ) : (
              <iframe
                src={cowUrlCbBtc}
                style={{ width: "100%", height: 640, border: 0, borderRadius: 12 }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone; web-share"
              />
            )
          ) : (
            <p style={{ opacity: 0.7 }}>Sem cbBTC para vender.</p>
          )}

          <h3 style={{ color: "#38bdf8", marginTop: 16 }}>CoW — ETH → USDC</h3>
          {ethSellWeiForCow > 0n ? (
            isMobile ? (
              <a
                href={cowUrlEth}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-block", padding: 12, borderRadius: 10, background: "#1f2937", color: "#fff", textDecoration: "none", marginBottom: 12 }}
              >
                Abrir na CoW (nova aba)
              </a>
            ) : (
              <iframe
                src={cowUrlEth}
                style={{ width: "100%", height: 640, border: 0, borderRadius: 12 }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone; web-share"
              />
            )
          ) : (
            <p style={{ opacity: 0.7 }}>Sem ETH líquido (após buffer) para vender.</p>
          )}

          <p style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
            Em dispositivos móveis, carteiras não injetam provider dentro de iframes. Por isso abrimos a CoW em uma nova aba. 
            Caso prefira execução automática, use o fallback via 0x.
          </p>
        </section>
      )}

      <pre
        style={{
          background: "#0b0b0b",
          color: "#a7f3d0",
          padding: 12,
          marginTop: 16,
          whiteSpace: "pre-wrap",
          textAlign: "left",
          borderRadius: 10,
          minHeight: 120,
        }}
      >
        {log || "Logs aparecerão aqui."}
      </pre>

      <p style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
        Powered by 0x. Atenção: swaps envolvem riscos e slippage. Verifique sempre os valores antes de assinar.
      </p>
    </main>
  )
}
