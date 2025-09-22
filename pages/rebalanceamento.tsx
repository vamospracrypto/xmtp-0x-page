// pages/rebalanceamento.tsx
import { useEffect, useMemo, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useBalance, usePublicClient, useWalletClient } from 'wagmi'
import { base } from 'wagmi/chains'
import axios, { AxiosError } from 'axios'
import {
  erc20Abi,
  formatUnits,
  getAddress,
  type TypedDataDomain,
  type TypedDataParameter,
} from 'viem'

/** ======= Constantes (Base) ======= */
const USDC  = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
const CBBTC = getAddress('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf')

// Limiares mínimos para evitar 404 de “valor muito baixo”
const MIN_ETH_WEI   = 5_000_000_000_000_000n; // 0.005 ETH
const MIN_CBBTC_WEI = 50_000n;                // ajuste conforme decimais do cbBTC (18). Aqui ~5e-14 cbBTC (bem baixo, aumente se necessário)

// CoW API (Base)
const COW_API = 'https://api.cow.fi/base-mainnet/api/v1'
// ETH “nativo” para a CoW (aceito pela API)
const COW_ETH = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
// Settlement (verifyingContract do EIP-712)
const COW_SETTLEMENT = getAddress('0x9008d19f58aAbd9eD0D60971565AA8510560ab41')

// 32 bytes zerados para appData (hex tipado)
const ZERO_APP_DATA = ('0x' + '0'.repeat(64)) as `0x${string}`

type ZeroExQuote = {
  to: `0x${string}`
  data: `0x${string}`
  allowanceTarget?: `0x${string}`
  buyAmount: string
  sellAmount: string
  value?: string
}

/** ======= 0x (fallback) ======= */
async function get0xQuoteBase(opts: {
  sellToken: string          // 'ETH' | token addr
  buyToken: string           // token addr
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
    value: data.value,
  }
}

/** ======= CoW helpers ======= */
type CowQuote = {
  quote: {
    buyAmount: string
    sellAmount: string
    feeAmount: string
  }
  from?: string
  expiration?: number
  id?: string
}

type CowOrder = {
  sellToken: string
  buyToken: string
  receiver: string
  sellAmount: string
  buyAmount: string
  validTo: number
  appData: `0x${string}`
  feeAmount: string
  kind: 'sell' | 'buy'
  partiallyFillable: boolean
  sellTokenBalance: 'erc20' | 'external' | 'internal'
  buyTokenBalance: 'erc20' | 'external' | 'internal'
}

const ORDER_TYPES: Record<string, TypedDataParameter[]> = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken',  type: 'address' },
    { name: 'receiver',  type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount',  type: 'uint256' },
    { name: 'validTo',    type: 'uint32'  },
    { name: 'appData',    type: 'bytes32' },
    { name: 'feeAmount',  type: 'uint256' },
    { name: 'kind',       type: 'string'  },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'sellTokenBalance',  type: 'string' },
    { name: 'buyTokenBalance',   type: 'string'  },
  ],
}

/** pega endereço do Vault Relayer (para approve) */
async function getCowVaultRelayer(): Promise<`0x${string}`> {
  const { data } = await axios.get(`${COW_API}/relayer`)
  return getAddress(data.address)
}

/** pede uma cotação na CoW */
async function getCowQuote(params: {
  sellToken: string    // address ou COW_ETH
  buyToken: string     // address
  sellAmountWei: string
  from: string
}): Promise<CowQuote> {
  const payload = {
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    from: params.from,
    receiver: params.from,
    // A API da CoW prefere "sellAmountBeforeFee" em wei (string)
    sellAmountBeforeFee: params.sellAmountWei,
  }
  const { data } = await axios.post(`${COW_API}/quote`, payload)
  return data
}

/** cria & envia ordem para CoW (assinatura EIP-712) */
async function postCowOrder(opts: {
  order: CowOrder
  owner: `0x${string}`
  chainId: number
  signTypedData: (args: {
    domain: TypedDataDomain
    types: Record<string, TypedDataParameter[]>
    primaryType: 'Order'
    message: any
  }) => Promise<`0x${string}`>
}) {
  const { order, owner, chainId, signTypedData } = opts

  const domain: TypedDataDomain = {
    name: 'Gnosis Protocol',
    version: 'v2',
    chainId,
    verifyingContract: COW_SETTLEMENT,
  }

  const signature = await signTypedData({
    domain,
    types: ORDER_TYPES,
    primaryType: 'Order',
    message: order,
  })

  const res = await axios.post(`${COW_API}/orders`, {
    ...order,
    signingScheme: 'eip712',
    signature,
    from: owner,
  })

  return res.data // orderUid, etc.
}

export default function Rebalanceamento() {
  const { address, chainId, isConnected } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  // Saldos
  const { data: ethBalUi } = useBalance({ address, chainId: base.id }) // ETH nativo
  const [cbBtcBal, setCbBtcBal] = useState<bigint>(0n)
  const [cbBtcDec, setCbBtcDec] = useState<number>(18)

  // UI
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')

  // ler cbBTC on-chain
  useEffect(() => {
    async function loadCbBtc() {
      try {
        if (!address || !publicClient || chainId !== base.id) return
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
        setCbBtcDec(dec)
        setCbBtcBal(bal)
      } catch { /* ignore */ }
    }
    loadCbBtc()
  }, [address, publicClient, chainId])

  const ethBal = useMemo(() => BigInt(ethBalUi?.value ?? 0n), [ethBalUi])

  // 30% em wei
  const thirtyEth = ethBal / 10n * 3n
  const thirtyCb  = cbBtcBal / 10n * 3n

  async function ensureApproveForCow(token: `0x${string}`, owner: `0x${string}`, amount: bigint) {
    if (!publicClient || !walletClient) return
    const relayer = await getCowVaultRelayer()
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner, relayer],
    }) as bigint

    if (allowance >= amount) return

    setLog(p => p + `\nAprovando ${token} para Vault Relayer da CoW...`)
    const tx = await walletClient.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [relayer, amount],
      chain: base,
    })
    await publicClient.waitForTransactionReceipt({ hash: tx })
    setLog(p => p + `\n✔️ Approve confirmado.`)
  }

  async function swapWith0x(sellToken: string, amountWei: bigint, label: string) {
    if (!address || !publicClient || !walletClient) return

    // proteção de mínimo também no fallback
    if (sellToken === 'ETH' && amountWei < MIN_ETH_WEI) {
      setLog(p => p + `\n⏭️  0x pulado (${label}): valor menor que o mínimo (${formatUnits(MIN_ETH_WEI, 18)} ETH).`)
      return
    }
    if (sellToken !== 'ETH' && amountWei < MIN_CBBTC_WEI) {
      setLog(p => p + `\n⏭️  0x pulado (${label}): valor muito pequeno.`)
      return
    }

    try {
      const quote = await get0xQuoteBase({
        sellToken,
        buyToken: USDC,
        sellAmountWei: amountWei.toString(),
        takerAddress: address,
      })

      // approve se necessário (apenas quando vendendo ERC-20)
      if (sellToken !== 'ETH' && quote.allowanceTarget) {
        const allowance = await publicClient.readContract({
          address: sellToken as `0x${string}`,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, quote.allowanceTarget as `0x${string}`],
        }) as bigint
        if (allowance < BigInt(quote.sellAmount)) {
          setLog(p => p + `\nAprovando (0x) ${sellToken}...`)
          const hash = await walletClient.writeContract({
            address: sellToken as `0x${string}`,
            abi: erc20Abi,
            functionName: 'approve',
            args: [quote.allowanceTarget as `0x${string}`, BigInt(quote.sellAmount)],
            chain: base,
          })
          await publicClient.waitForTransactionReceipt({ hash })
        }
      }

      setLog(p => p + `\nExecutando via 0x — ${label} → USDC...`)
      const txHash = await walletClient.sendTransaction({
        to: quote.to,
        data: quote.data,
        value: sellToken === 'ETH' ? BigInt(quote.value ?? '0') : 0n,
        chain: base,
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      setLog(p => p + `\n✔️ ${label} → USDC confirmado (0x).`)
    } catch (err) {
      const ax = err as AxiosError<any>
      setLog(p => p + `\n❌ Fallback 0x falhou (${label}): ${ax.response?.status ?? ''} ${ax.response?.data?.reason || ax.message}`)
    }
  }

  async function rebalance30ToUSDC() {
    try {
      if (!isConnected || !address || !publicClient || !walletClient) return
      if (chainId !== base.id) throw new Error('Troque a rede para Base.')

      setBusy(true)
      setLog('Iniciando rebalanceamento (CoW como principal; 0x fallback)...')

      /** ===== ETH -> USDC (CoW) ===== */
      if (thirtyEth > 0n) {
        setLog(p => p + `\nETH: 30% = ${formatUnits(thirtyEth, 18)} ETH`)
        if (thirtyEth < MIN_ETH_WEI) {
          setLog(p => p + `\n⏭️  CoW pulado (ETH → USDC): montante abaixo do mínimo (${formatUnits(MIN_ETH_WEI, 18)} ETH).`)
        } else {
          try {
            const q = await getCowQuote({
              sellToken: COW_ETH,
              buyToken: USDC,
              sellAmountWei: thirtyEth.toString(),
              from: address,
            })

            const validTo = Math.floor(Date.now() / 1000) + 60 * 15 // 15 min
            const order: CowOrder = {
              sellToken: COW_ETH,
              buyToken: USDC,
              receiver: address,
              sellAmount: q.quote.sellAmount,
              buyAmount: q.quote.buyAmount,
              feeAmount: q.quote.feeAmount,
              validTo,
              appData: ZERO_APP_DATA,
              kind: 'sell',
              partiallyFillable: false,
              sellTokenBalance: 'external', // ETH sai direto da carteira
              buyTokenBalance: 'erc20',
            }

            setLog(p => p + `\nAssinando ordem CoW (ETH → USDC)...`)
            const orderRes = await postCowOrder({
              order,
              owner: address,
              chainId: base.id,
              signTypedData: async (args) =>
                walletClient!.signTypedData({
                  domain: args.domain,
                  types: args.types as any,
                  primaryType: args.primaryType,
                  message: args.message,
                }) as Promise<`0x${string}`>,
            })

            setLog(p => p + `\n✔️ Ordem CoW enviada (ETH → USDC): ${orderRes?.orderUid ?? ''}`)
            setLog(p => p + `\n(Obs.: CoW é gasless; a execução ocorre quando o solver encontra o match.)`)
          } catch (err) {
            const ax = err as AxiosError<any>
            const is404 = (ax.response?.status === 404)
            setLog(p => p + `\n⚠️ CoW falhou (ETH → USDC): ${ax.response?.status ?? ''} ${ax.response?.data?.error || ax.message}${is404 ? ' — possivelmente valor baixo ou sem rota no momento.' : ''} Tentando 0x...`)
            await swapWith0x('ETH', thirtyEth, 'ETH')
          }
        }
      } else {
        setLog(p => p + `\nSem ETH suficiente para rebalancear.`)
      }

      /** ===== cbBTC -> USDC (CoW) ===== */
      if (thirtyCb > 0n) {
        setLog(p => p + `\ncbBTC: 30% = ${formatUnits(thirtyCb, cbBtcDec)} cbBTC`)
        if (thirtyCb < MIN_CBBTC_WEI) {
          setLog(p => p + `\n⏭️  CoW pulado (cbBTC → USDC): montante muito pequeno.`)
        } else {
          try {
            // approve para o Vault Relayer
            await ensureApproveForCow(CBBTC, address, thirtyCb)

            const q = await getCowQuote({
              sellToken: CBBTC,
              buyToken: USDC,
              sellAmountWei: thirtyCb.toString(),
              from: address,
            })

            const validTo = Math.floor(Date.now() / 1000) + 60 * 15
            const order: CowOrder = {
              sellToken: CBBTC,
              buyToken: USDC,
              receiver: address,
              sellAmount: q.quote.sellAmount,
              buyAmount: q.quote.buyAmount,
              feeAmount: q.quote.feeAmount,
              validTo,
              appData: ZERO_APP_DATA,
              kind: 'sell',
              partiallyFillable: false,
              sellTokenBalance: 'erc20',
              buyTokenBalance: 'erc20',
            }

            setLog(p => p + `\nAssinando ordem CoW (cbBTC → USDC)...`)
            const orderRes = await postCowOrder({
              order,
              owner: address,
              chainId: base.id,
              signTypedData: async (args) =>
                walletClient!.signTypedData({
                  domain: args.domain,
                  types: args.types as any,
                  primaryType: args.primaryType,
                  message: args.message,
                }) as Promise<`0x${string}`>,
            })

            setLog(p => p + `\n✔️ Ordem CoW enviada (cbBTC → USDC): ${orderRes?.orderUid ?? ''}`)
          } catch (err) {
            const ax = err as AxiosError<any>
            const is404 = (ax.response?.status === 404)
            setLog(p => p + `\n⚠️ CoW falhou (cbBTC → USDC): ${ax.response?.status ?? ''} ${ax.response?.data?.error || ax.message}${is404 ? ' — possivelmente valor baixo ou sem rota no momento.' : ''} Tentando 0x...`)
            await swapWith0x(CBBTC, thirtyCb, 'cbBTC')
          }
        }
      } else {
        setLog(p => p + `\nSem cbBTC suficiente para rebalancear.`)
      }

      if (thirtyEth === 0n && thirtyCb === 0n) {
        setLog(p => p + `\nNada para rebalancear.`)
      } else {
        setLog(p => p + `\n✅ Fluxo concluído (ordens CoW enviadas e/ou fallback 0x executado).`)
      }
    } catch (e: any) {
      const msg = e?.response?.data?.reason || e?.shortMessage || e?.message || String(e)
      setLog(p => p + `\n❌ Erro: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: 16 }}>
      <h1>Rebalanceamento — 30% para USDC (CoW & 0x fallback)</h1>
      <ConnectButton />

      {isConnected ? (
        <>
          <div style={{ marginTop: 16 }}>
            <p><strong>Rede:</strong> {chainId === base.id ? 'Base' : 'Outra'}</p>
            <p>
              <strong>ETH:</strong> {ethBalUi ? `${ethBalUi.formatted} ETH` : '-'} &nbsp;|&nbsp;
              <strong>cbBTC:</strong> {formatUnits(cbBtcBal, cbBtcDec)} cbBTC
            </p>
            <p>
              <strong>30% ETH:</strong> {formatUnits(thirtyEth, 18)} ETH &nbsp;|&nbsp;
              <strong>30% cbBTC:</strong> {formatUnits(thirtyCb, cbBtcDec)} cbBTC
            </p>
          </div>

          <button
            onClick={rebalance30ToUSDC}
            disabled={busy || chainId !== base.id}
            style={{ marginTop: 12, padding: '10px 16px', fontWeight: 700, borderRadius: 10, background: '#16a34a', color: '#fff', border: 'none' }}
          >
            {busy ? 'Executando…' : 'Rebalancear (30% → USDC)'}
          </button>

          <pre style={{ background: '#0b0b0b', color: '#a7f3d0', padding: 12, marginTop: 16, whiteSpace: 'pre-wrap' }}>
            {log || 'Logs aparecerão aqui.'}
          </pre>

          <p style={{ fontSize: 12, opacity: .8 }}>
            CoW = assinatura EIP-712 (gasless, ordem off-chain). Se a CoW não cotar no momento
            (valor baixo ou sem rota), o fallback 0x tenta executar on-chain. Tenha ETH para gás.
          </p>
        </>
      ) : (
        <p style={{ marginTop: 16 }}>Conecte sua carteira na rede Base para continuar.</p>
      )}
    </main>
  )
}
