// pages/rebalanceamento.tsx
import { useEffect, useMemo, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { base } from 'wagmi/chains'
import { erc20Abi, formatUnits, getAddress } from 'viem'
import axios, { AxiosError } from 'axios'
import Image from 'next/image'

// detector simples de mobile (iOS/Android)
const isMobile = typeof navigator !== 'undefined'
  ? /iphone|ipad|ipod|android/i.test(navigator.userAgent)
  : false

// contratos (Base)
const USDC  = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const CBBTC = getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf')

// 0x: tipos e função (usado apenas como fallback automático)
type ZeroExQuote = {
  to: `0x${string}`
  data: `0x${string}`
  allowanceTarget?: `0x${string}`
  buyAmount: string
  sellAmount: string
}

async function get0xQuoteBase(opts: {
  sellToken: string
  buyToken: string
  sellAmountWei: string
  takerAddress: string
  slippagePerc?: number
}): Promise<ZeroExQuote> {
  const { sellToken, buyToken, sellAmountWei, takerAddress, slippagePerc = 0.005 } = opts
  const { data } = await axios.get('https://base.api.0x.org/swap/v1/quote', {
    params: {
      sellToken,
      buyToken,
      sellAmount: sellAmountWei,
      takerAddress,
      slippagePercentage: slippagePerc.toString(),
    },
  })
  return {
    to: data.to,
    data: data.data,
    allowanceTarget: data.allowanceTarget || data.spender,
    buyAmount: data.buyAmount,
    sellAmount: data.sellAmount,
  }
}

export default function Rebalanceamento() {
  const { address, chainId, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [log, setLog] = useState('')
  const [busy, setBusy] = useState(false)

  // saldos
  const [ethWei, setEthWei] = useState<bigint>(0n)
  const [cbBtcWei, setCbBtcWei] = useState<bigint>(0n)
  const [cbBtcDecimals, setCbBtcDecimals] = useState<number>(8)

  // 30%
  const eth30 = useMemo(() => (ethWei * 30n) / 100n, [ethWei])
  const cbBtc30 = useMemo(() => (cbBtcWei * 30n) / 100n, [cbBtcWei])

  // strings decimais (CoW widget usa decimais, não wei)
  const eth30Decimal = useMemo(() => formatUnits(eth30, 18), [eth30])
  const cbBtc30Decimal = useMemo(() => formatUnits(cbBtc30, cbBtcDecimals), [cbBtc30, cbBtcDecimals])

  // URLs dos widgets da CoW (cadeia 8453 = Base)
  const cowUrlEthToUsdc = useMemo(() => {
    if (!eth30 || eth30 === 0n) return ''
    return `https://swap.cow.fi/#/8453/swap/ETH/${USDC}?sellAmount=${eth30Decimal}&theme=dark&hideNetworkSelector=true`
  }, [eth30, eth30Decimal])

  const cowUrlCbBtcToUsdc = useMemo(() => {
    if (!cbBtc30 || cbBtc30 === 0n) return ''
    return `https://swap.cow.fi/#/8453/swap/${CBBTC}/${USDC}?sellAmount=${cbBtc30Decimal}&theme=dark&hideNetworkSelector=true`
  }, [cbBtc30, cbBtc30Decimal])

  // ler saldos
  useEffect(() => {
    const load = async () => {
      if (!address || !publicClient || chainId !== base.id) return
      try {
        setBusy(true)
        setLog('')
        setLog(p => p + 'Lendo saldos na Base...\n')

        // ETH
        const ethHex = await publicClient.request({
          method: 'eth_getBalance',
          params: [address, 'latest'],
        })
        const eth = BigInt(ethHex)
        setEthWei(eth)

        // cbBTC
        const [dec, bal] = await Promise.all([
          publicClient.readContract({
            address: CBBTC,
            abi: erc20Abi,
            functionName: 'decimals',
          }) as Promise<number>,
          publicClient.readContract({
            address: CBBTC,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          }) as Promise<bigint>,
        ])
        setCbBtcDecimals(dec)
        setCbBtcWei(bal)

        setLog(p => p +
          `ETH: ${formatUnits(eth, 18)} | cbBTC: ${formatUnits(bal, dec)}\n` +
          `30% ETH: ${formatUnits((eth * 30n) / 100n, 18)} | 30% cbBTC: ${formatUnits((bal * 30n) / 100n, dec)}\n`
        )
      } catch (e: any) {
        setLog(p => p + `❌ Erro ao ler saldos: ${e?.message || String(e)}\n`)
      } finally {
        setBusy(false)
      }
    }
    load()
  }, [address, chainId, publicClient])

  // fallback 0x automático (opcional)
  async function runFallbackZeroX() {
    if (!address || !publicClient || !walletClient) return
    if (chainId !== base.id) {
      setLog(p => p + 'Troque para a rede Base.\n')
      return
    }
    try {
      setBusy(true)
      setLog(p => p + 'Iniciando fallback 0x...\n')

      const actions: Array<{ label: string; q?: ZeroExQuote | null }> = []

      // ETH → USDC
      if (eth30 > 0n) {
        try {
          const qEth = await get0xQuoteBase({
            sellToken: 'ETH',
            buyToken: USDC,
            sellAmountWei: eth30.toString(),
            takerAddress: address,
          })
          actions.push({ label: 'ETH → USDC', q: qEth })
        } catch (err) {
          const ax = err as AxiosError<any>
          setLog(p => p + `⚠️ 0x falhou (ETH): ${ax.response?.status ?? ''} ${ax.response?.data?.reason || ax.message}\n`)
        }
      }

      // cbBTC → USDC
      if (cbBtc30 > 0n) {
        try {
          const qCb = await get0xQuoteBase({
            sellToken: CBBTC,
            buyToken: USDC,
            sellAmountWei: cbBtc30.toString(),
            takerAddress: address,
          })
          actions.push({ label: 'cbBTC → USDC', q: qCb })
        } catch (err) {
          const ax = err as AxiosError<any>
          setLog(p => p + `⚠️ 0x falhou (cbBTC): ${ax.response?.status ?? ''} ${ax.response?.data?.reason || ax.message}\n`)
        }
      }

      // approvals e execução
      for (const a of actions) {
        if (!a.q) continue
        const { q } = a

        if (q.allowanceTarget && q.sellAmount !== '0') {
          try {
            const allowance = await publicClient.readContract({
              address: CBBTC,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [address, q.allowanceTarget],
            }) as bigint

            if (allowance < BigInt(q.sellAmount)) {
              setLog(p => p + `Aprovando cbBTC para ${q.allowanceTarget}...\n`)
              const tx = await walletClient.writeContract({
                address: CBBTC,
                abi: erc20Abi,
                functionName: 'approve',
                args: [q.allowanceTarget, BigInt(q.sellAmount)],
                chain: base,
              })
              await publicClient.waitForTransactionReceipt({ hash: tx })
              setLog(p => p + '✔️ Approve confirmado.\n')
            }
          } catch (e: any) {
            setLog(p => p + `⚠️ Erro no approve: ${e?.shortMessage || e?.message}\n`)
          }
        }

        setLog(p => p + `Enviando ${a.label} via 0x...\n`)
        const h = await walletClient.sendTransaction({
          to: q.to,
          data: q.data,
          value: 0n,
          chain: base,
        })
        await publicClient.waitForTransactionReceipt({ hash: h })
        setLog(p => p + `✔️ ${a.label} confirmado.\n`)
      }

      setLog(p => p + 'Fluxo fallback 0x concluído.\n')
    } catch (e: any) {
      setLog(p => p + `❌ Erro (0x): ${e?.response?.data?.reason || e?.shortMessage || e?.message || String(e)}\n`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      style={{
        maxWidth: 980,
        margin: '40px auto',
        padding: 16,
        textAlign: 'center',
        background: '#000',
        color: '#fff',
        borderRadius: 12,
      }}
    >
      {/* logo no topo (mesmo da index) */}
      <div style={{ marginBottom: 16 }}>
        <Image
          src="/logo-vamos.png"
          alt="Vamos Pra Crypto"
          width={140}
          height={140}
          priority
        />
      </div>

      <h1 style={{ color: '#4ade80', marginTop: 0 }}>
        Rebalanceamento — 30% para USDC (CoW principal)
      </h1>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 10 }}>
        <ConnectButton />
      </div>

      <p style={{ opacity: 0.9, marginTop: 4 }}>
        <b>Rede:</b> {chainId === base.id ? 'Base' : '—'}
      </p>

      <p style={{ margin: 0 }}>
        <b>ETH:</b> {formatUnits(ethWei, 18)} ETH &nbsp;|&nbsp;
        <b>cbBTC:</b> {formatUnits(cbBtcWei, cbBtcDecimals)} cbBTC
      </p>
      <p style={{ marginTop: 4 }}>
        <b>30% ETH:</b> {formatUnits(eth30, 18)} &nbsp;|&nbsp;
        <b>30% cbBTC:</b> {formatUnits(cbBtc30, cbBtcDecimals)}
      </p>

      {isConnected && chainId === base.id ? (
        <>
          {/* ações */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
            <button
              onClick={runFallbackZeroX}
              disabled={busy}
              style={{
                padding: '10px 16px',
                fontWeight: 700,
                borderRadius: 10,
                background: '#111827',
                color: '#fff',
                border: 'none',
              }}
            >
              Fallback 0x (automático)
            </button>
          </div>

          {/* logs */}
          <pre
            style={{
              background: '#0b0b0b',
              color: '#a7f3d0',
              padding: 12,
              marginTop: 16,
              whiteSpace: 'pre-wrap',
              textAlign: 'left',
              borderRadius: 8,
            }}
          >
            {log || 'Pronto para rebalancear. Use os widgets da CoW abaixo.'}
          </pre>

          {/* CoW — ETH → USDC */}
          <h3 style={{ marginTop: 18, color: '#38bdf8' }}>
            CoW — ETH → USDC (30% do ETH)
          </h3>
          {eth30 > 0n ? (
            isMobile ? (
              <a
                href={cowUrlEthToUsdc}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: '#1f2937',
                  color: '#fff',
                  textDecoration: 'none',
                  marginBottom: 16,
                }}
              >
                Abrir ETH→USDC na CoW (nova aba)
              </a>
            ) : (
              <iframe
                src={cowUrlEthToUsdc}
                style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone; web-share"
              />
            )
          ) : (
            <p style={{ opacity: 0.8 }}>Nenhum ETH para vender.</p>
          )}

          {/* CoW — cbBTC → USDC */}
          <h3 style={{ marginTop: 18, color: '#38bdf8' }}>
            CoW — cbBTC → USDC (30% do cbBTC)
          </h3>
          {cbBtc30 > 0n ? (
            isMobile ? (
              <a
                href={cowUrlCbBtcToUsdc}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block',
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: '#1f2937',
                  color: '#fff',
                  textDecoration: 'none',
                  marginBottom: 16,
                }}
              >
                Abrir cbBTC→USDC na CoW (nova aba)
              </a>
            ) : (
              <iframe
                src={cowUrlCbBtcToUsdc}
                style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone; web-share"
              />
            )
          ) : (
            <p style={{ opacity: 0.8 }}>Nenhum cbBTC para vender.</p>
          )}

          <p style={{ marginTop: 8, fontSize: 12, opacity: .75 }}>
            CoW = assinatura EIP-712 (gasless, ordem off-chain). Em iPhone/iPad/Android, as carteiras não expõem o
            provider dentro de iframes; por isso abrimos o widget em uma nova aba. Se quiser execução automática on-chain,
            use o fallback 0x.
          </p>
        </>
      ) : (
        <p style={{ marginTop: 16 }}>Conecte sua carteira na rede Base para continuar.</p>
      )}
    </main>
  )
}
