export function usd(amount: number) {
  return `$${amount.toFixed(12).replace(/0+$/, "").replace(/\.$/, "")}`
}

export function balanceLabel(balance: number | null) {
  return balance === null ? "balance: no limit" : `balance ${usd(balance)}`
}
