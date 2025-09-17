// pages/index.tsx
import { useMemo, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, usePublicClient, useWalletClient, useBalance } from 'wagmi'
import { base } from 'wagmi/chains'
import axios, { AxiosError } from 'axios'
import { erc20Abi, formatUnits, getAddress } from 'viem'
import Image from "next/image";

export default function HomePage() {
  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      {/* LOGO RESPONSIVO */}
      <div style={{ maxWidth: "200px", margin: "0 auto" }}>
        <Image
          src="/vamos-pra-crypto-logo.png"
          alt="Vamos Pra Crypto"
          width={500}   // tamanho base
          height={500}  // mantém proporção
          style={{
            width: "100%",   // ocupa até 100% do container
            height: "auto",  // ajusta automaticamente
          }}
          priority
        />
      </div>

      {/* TÍTULO */}
      <h1 style={{ marginTop: "20px" }}>Executar 50/50 Swap</h1>

      {/* resto da página */}
    </div>
  );
}


const USDC  = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const CBBTC = getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf')
const USDC_DECIMALS = 6
const ALCHEMY_KEY = process.env.NEXT_PUBLIC_ALCHEMY_KEY || ''

type ZeroExQuote = {
  to: `0x${string}`
  data: `0x${string}`
  allowanceTarget?: `0x${string}`
  buyAmount: string
  sellAmount: string
}

async function get0xQuoteBase(opts: {
  sellToken: string
  buyToken: string // ERC20 addr ou 'ETH'
  sellAmountWei: string
  takerAddress: string
  slippagePerc?: number
}): Promise<ZeroExQuote> {
  const { sellToken, buyToken, sellAmountWei, takerAddress, slippagePerc = 0.005 } = opts
  const { data } = await axios.get('https://base.api.0x.org/swap/v1/quote', {
    params: {
      sellToken,
      buyToken, // 'ETH' string para nativo
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

export default function Home() {
  const { address, chainId, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  // controle de CoW (principal)
  const [showCow, setShowCow] = useState(false)
  const [halfAmountWei, setHalfAmountWei] = useState<bigint>(0n)

  // fallback 0x
  const [enableZeroX, setEnableZeroX] = useState(false)

  // saldos
  const [loadingBalances, setLoadingBalances] = useState(false)
  const [balances, setBalances] = useState<
    { symbol: string; name: string; contract: string; balance: string }[]
  >([])

  const { data: usdcBalUi } = useBalance({ address, token: USDC, chainId: base.id })

  // URLs do CoW widget (iframe)
  const cowUrlCbBtc = useMemo(() => {
    if (!halfAmountWei) return ''
    const sellAmount = formatUnits(halfAmountWei, USDC_DECIMALS)
    return `https://swap.cow.fi/#/8453/swap/${USDC}/${CBBTC}?sellAmount=${sellAmount}&theme=light&hideNetworkSelector=true`
  }, [halfAmountWei])
  const cowUrlEth = useMemo(() => {
    if (!halfAmountWei) return ''
    const sellAmount = formatUnits(halfAmountWei, USDC_DECIMALS)
    return `https://swap.cow.fi/#/8453/swap/${USDC}/ETH?sellAmount=${sellAmount}&theme=light&hideNetworkSelector=true`
  }, [halfAmountWei])

  async function prepareAmountsAndShowCow() {
    if (!address || !publicClient) return
    if (chainId !== base.id) throw new Error('Troque a rede para Base.')
    setShowCow(false)
    setLog('Lendo saldo USDC on-chain...')

    const [dec, rawBal] = await Promise.all([
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'decimals',
      }) as Promise<number>,
      publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      }) as Promise<bigint>,
    ])
    if (dec !== USDC_DECIMALS) throw new Error('Decimais de USDC inesperados.')
    if (rawBal === 0n) throw new Error('Sem USDC na Base.')

    const half = rawBal / 2n
    setHalfAmountWei(half)
    setLog((p) => p + `\nMetade do USDC: ${formatUnits(half, USDC_DECIMALS)}.`)
    setShowCow(true)
  }

  async function handleExecuteCowFirst() {
    try {
      setBusy(true)
      await prepareAmountsAndShowCow()
      setEnableZeroX(true) // habilita botão de fallback 0x
      setLog((p) => p + `\nWidgets da CoW carregados. Se preferir execução automática, use o fallback 0x abaixo.`)
    } catch (e: any) {
      const msg = e?.shortMessage || e?.message || String(e)
      setLog((p) => p + `\n❌ Erro: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  // Fallback 0x (execução automática)
  async function tryZeroXAuto() {
    try {
      if (!address || !publicClient || !walletClient) return
      if (chainId !== base.id) throw new Error('Troque a rede para Base.')
      setBusy(true)
      setLog((p) => p + `\nBuscando rotas na 0x...`)

      // se ainda não calculamos half, calcula agora
      if (halfAmountWei === 0n) await prepareAmountsAndShowCow()

      // 2 quotes (USDC->cbBTC e USDC->ETH)
      let qCb: ZeroExQuote | null = null
      let qEth: ZeroExQuote | null = null

      try {
        qCb = await get0xQuoteBase({
          sellToken: USDC,
          buyToken: CBBTC,
          sellAmountWei: halfAmountWei.toString(),
          takerAddress: address,
        })
      } catch (err) {
        const ax = err as AxiosError<any>
        setLog((p) => p + `\n⚠️ 0x cbBTC falhou: ${ax.response?.status ?? ''} ${ax.response?.data?.reason || ax.message}`)
      }

      try {
        qEth = await get0xQuoteBase({
          sellToken: USDC,
          buyToken: 'ETH',
          sellAmountWei: halfAmountWei.toString(),
          takerAddress: address,
        })
      } catch (err) {
        const ax = err as AxiosError<any>
        setLog((p) => p + `\n⚠️ 0x ETH falhou: ${ax.response?.status ?? ''} ${ax.response?.data?.reason || ax.message}`)
      }

      // Approvals por spender (se necessário)
      const porSpender = new Map<string, bigint>()
      const add = (q?: ZeroExQuote | null) => {
        if (!q?.allowanceTarget) return
        porSpender.set(q.allowanceTarget, (porSpender.get(q.allowanceTarget) ?? 0n) + BigInt(q.sellAmount))
      }
      add(qCb)
      add(qEth)

      for (const [spender, total] of porSpender) {
        const allowance = await publicClient.readContract({
          address: USDC,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, spender as `0x${string}`],
        }) as bigint

        if (allowance < total) {
          setLog((p) => p + `\nAprovando USDC para ${spender}...`)
          const approveHash = await walletClient.writeContract({
            address: USDC,
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender as `0x${string}`, total],
            chain: base,
          })
          await publicClient.waitForTransactionReceipt({ hash: approveHash })
          setLog((p) => p + `\n✔️ Approve confirmado.`)
        }
      }

      // Executa o que tiver rota
      if (qCb) {
        setLog((p) => p + `\nEnviando swap USDC → cbBTC (0x)...`)
        const h = await walletClient.sendTransaction({ to: qCb.to, data: qCb.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash: h })
        setLog((p) => p + `\n✔️ cbBTC confirmado (0x).`)
      }
      if (qEth) {
        setLog((p) => p + `\nEnviando swap USDC → ETH (0x)...`)
        const h = await walletClient.sendTransaction({ to: qEth.to, data: qEth.data, value: 0n, chain: base })
        await publicClient.waitForTransactionReceipt({ hash: h })
        setLog((p) => p + `\n✔️ ETH confirmado (0x).`)
      }
      if (!qCb && !qEth) setLog((p) => p + `\nSem rotas na 0x para as duas pernas.`)
    } catch (e: any) {
      const msg = e?.response?.data?.reason || e?.shortMessage || e?.message || String(e)
      setLog((p) => p + `\n❌ Erro (0x): ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  // Mostrar saldos via Alchemy (Base)
  async function fetchAllBalances() {
    try {
      if (!address) return
      setLoadingBalances(true)
      const list: { symbol: string; name: string; contract: string; balance: string }[] = []

      // ETH
      const ethHex = await publicClient!.request({ method: 'eth_getBalance', params: [address, 'latest'] })
      const eth = formatUnits(BigInt(ethHex), 18)
      list.push({ symbol: 'ETH', name: 'Ether', contract: 'native', balance: eth })

      if (!ALCHEMY_KEY) {
        setBalances(list)
        return
      }

      const rpc = `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`

      // ERC-20 balances
      const { data: tb } = await axios.post(rpc, {
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_getTokenBalances',
        params: [address, 'erc20'],
      })

      const tokenBalances: { contractAddress: string; tokenBalance: string }[] =
        tb?.result?.tokenBalances || []

      // pega metadata p/ cada token e formata apenas os que têm saldo > 0
      for (const t of tokenBalances) {
        try {
          const bal = BigInt(t.tokenBalance || '0x0')
          if (bal === 0n) continue

          const { data: md } = await axios.post(rpc, {
            jsonrpc: '2.0',
            id: 2,
            method: 'alchemy_getTokenMetadata',
            params: [t.contractAddress],
          })
          const sym = md?.result?.symbol || 'UNK'
          const name = md?.result?.name || 'Unknown'
          const dec = Number(md?.result?.decimals ?? 18)
          list.push({
            symbol: sym,
            name,
            contract: t.contractAddress,
            balance: formatUnits(bal, dec),
          })
        } catch {
          // ignora token com erro de metadata
        }
      }

      // ordena por valor string desc (só para visual)
      setBalances(list.sort((a, b) => Number(b.balance) - Number(a.balance)))
    } catch (e: any) {
      setLog((p) => p + `\n❌ Erro ao buscar saldos: ${e?.message || String(e)}`)
    } finally {
      setLoadingBalances(false)
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: 16 }}>
      <h1>Executar 50/50 Swap</h1>
      <ConnectButton />

      {isConnected ? (
        <>
          <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={handleExecuteCowFirst}
              disabled={busy}
              style={{ padding: '10px 16px', fontWeight: 700, borderRadius: 10, background: '#16a34a', color: '#fff', border: 'none' }}
            >
              {busy ? 'Preparando…' : 'Executar 50/50 (CoW)'}
            </button>

            <button
              onClick={tryZeroXAuto}
              disabled={!enableZeroX || busy}
              title={!enableZeroX ? 'Carregue os widgets da CoW primeiro' : ''}
              style={{ padding: '10px 16px', fontWeight: 700, borderRadius: 10, background: '#111827', color: '#fff', border: 'none', opacity: enableZeroX ? 1 : 0.5 }}
            >
              Fallback 0x (automático)
            </button>

            <button
              onClick={fetchAllBalances}
              disabled={loadingBalances}
              style={{ padding: '10px 16px', fontWeight: 700, borderRadius: 10, background: '#2563eb', color: '#fff', border: 'none' }}
            >
              {loadingBalances ? 'Carregando…' : 'Mostrar saldos (Base)'}
            </button>
          </div>

          <p style={{ marginTop: 12 }}>
            Saldo em USDC: {usdcBalUi ? `${usdcBalUi.formatted} ${usdcBalUi.symbol}` : '-'}
          </p>

          <pre style={{ background: '#0b0b0b', color: '#a7f3d0', padding: 12, marginTop: 16, whiteSpace: 'pre-wrap' }}>
            {log || 'Logs aparecerão aqui.'}
          </pre>

          {/* Widgets da CoW (principal) */}
          {showCow && halfAmountWei > 0n && (
            <>
              <h3 style={{ marginTop: 18 }}>CoW — USDC → cbBTC (50%)</h3>
              <iframe
                src={cowUrlCbBtc}
                style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone"
              />
              <h3 style={{ marginTop: 18 }}>CoW — USDC → ETH (50%)</h3>
              <iframe
                src={cowUrlEth}
                style={{ width: '100%', height: 680, border: 0, borderRadius: 12 }}
                allow="clipboard-write; payment; accelerometer; autoplay; camera; gyroscope; microphone"
              />
              <p style={{ marginTop: 8, fontSize: 12, opacity: .8 }}>
                As ordens da CoW são gasless (assinatura off-chain com proteção MEV). Se preferir execução automática on-chain, use o fallback 0x.
              </p>
            </>
          )}

          {/* Saldos listados */}
          {balances.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3>Saldos na Base</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: 8 }}>Token</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Símbolo</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Saldo</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>Contrato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.map((b, i) => (
                      <tr key={b.contract + i} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={{ padding: 8 }}>{b.name}</td>
                        <td style={{ padding: 8 }}>{b.symbol}</td>
                        <td style={{ padding: 8 }}>{b.balance}</td>
                        <td style={{ padding: 8, fontFamily: 'monospace' }}>{b.contract}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!ALCHEMY_KEY && (
                <p style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>
                  Dica: adicione <code>NEXT_PUBLIC_ALCHEMY_KEY</code> na Vercel para ver todos os ERC-20. Sem a chave, mostro apenas ETH.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <p style={{ marginTop: 16 }}>Conecte sua carteira para continuar.</p>
      )}
    </main>
  )
}
