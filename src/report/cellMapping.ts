type CellId =
  | 'A1'
  | 'A2'
  | 'A3'
  | 'B1'
  | 'B2'
  | 'B3'
  | 'C1'
  | 'C2'
  | 'C3'

type MatrixRow = 'world' | 'product' | 'elements'
type MatrixCol = 'as_is' | 'not_working' | 'should_be'

type MatrixItem = {
  matrixRow?: string | null
  matrixCol?: string | null
}

const rowToGroup = (row: MatrixRow) => (row === 'world' ? 'A' : row === 'product' ? 'B' : 'C')
const colToMode = (col: MatrixCol) => (col === 'as_is' ? '1' : col === 'not_working' ? '2' : '3')

export const getCellId = (item: MatrixItem): CellId | null => {
  const rawRow = (item.matrixRow || '').toLowerCase() as MatrixRow
  const rawCol = (item.matrixCol || '').toLowerCase() as MatrixCol
  if (!['world', 'product', 'elements'].includes(rawRow)) return null
  if (!['as_is', 'not_working', 'should_be'].includes(rawCol)) return null
  return `${rowToGroup(rawRow)}${colToMode(rawCol)}` as CellId
}

export const groupItemsByCell = <T extends MatrixItem>(items: T[]) => {
  const result: Record<CellId, T[]> = {
    A1: [],
    A2: [],
    A3: [],
    B1: [],
    B2: [],
    B3: [],
    C1: [],
    C2: [],
    C3: [],
  }
  const unassigned: T[] = []
  items.forEach((item) => {
    const cell = getCellId(item)
    if (!cell) {
      unassigned.push(item)
      return
    }
    result[cell].push(item)
  })
  return { cells: result, unassigned }
}
