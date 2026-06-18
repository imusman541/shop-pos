import React, { useEffect, useState, useCallback } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts'
import { money, int, daysAgo, fmtDate, pctChange } from '../lib/format'
import DateRangePicker from '../components/DateRangePicker'
import ProductMultiSelect from '../components/ProductMultiSelect'
import { IconTrendUp, IconTrendDown } from '../components/icons'

const COLORS = { sales: '#3b7dd8', profit: '#2fa36b', items: '#e8923b' }

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null
  const byKey = {}
  payload.forEach((p) => { byKey[p.dataKey] = p.value })
  return (
    <div className="chart-tooltip">
      <div className="tt-date">{fmtDate(label)}</div>
      <div className="tt-row">
        <span className="k"><i style={{ background: COLORS.sales }} />Sales</span>
        <span className="v">{money(byKey.sales)}</span>
      </div>
      <div className="tt-row">
        <span className="k"><i style={{ background: COLORS.profit }} />Profit</span>
        <span className="v">{money(byKey.profit)}</span>
      </div>
      <div className="tt-row">
        <span className="k"><i style={{ background: COLORS.items }} />Items sold</span>
        <span className="v">{int(byKey.items)}</span>
      </div>
    </div>
  )
}

const KpiDelta = ({ current, previous, format = 'money', periodDays }) => {
  const change = pctChange(current, previous)
  const up = change >= 0
  const display = format === 'money' ? money(previous) : int(previous)
  const dayLabel = periodDays === 1 ? 'day' : 'days'

  return (
    <div className="kpi-delta">
      <span className="kpi-delta-label">vs prev {periodDays} {dayLabel}</span>
      <span className="kpi-delta-row">
        <span className="kpi-delta-prev">{display}</span>
        <span className={`kpi-delta-trend ${up ? 'up' : 'down'}`}>
          {up ? <IconTrendUp /> : <IconTrendDown />}
          {Math.abs(change).toFixed(1)}%
        </span>
      </span>
    </div>
  )
}

const Dashboard = () => {
  const [start, setStart] = useState(daysAgo(13))
  const [end, setEnd] = useState(daysAgo(0))
  const [productIds, setProductIds] = useState([])
  const [products, setProducts] = useState([])
  const [data, setData] = useState({
    series: [],
    totals: { sales: 0, profit: 0, items: 0 },
    previousTotals: { sales: 0, profit: 0, items: 0 },
    previousPeriod: null
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.listProductsBrief().then(setProducts)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await window.api.getDashboard({
      startDate: start,
      endDate: end,
      productIds: productIds.map(Number)
    })
    setData(res)
    setLoading(false)
  }, [start, end, productIds])

  useEffect(() => { load() }, [load])

  const { series, totals, previousTotals, previousPeriod } = data
  const periodDays = previousPeriod?.days ?? 0

  const handleRangeChange = ({ start: nextStart, end: nextEnd }) => {
    setStart(nextStart)
    setEnd(nextEnd)
  }

  return (
    <div className="dashboard">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Sales, profit and items sold over time. Cancelled orders are excluded.</p>
        </div>
      </div>

      <div className="card toolbar dashboard-toolbar">
        <DateRangePicker
          start={start}
          end={end}
          max={daysAgo(0)}
          onChange={handleRangeChange}
        />
        <ProductMultiSelect
          products={products}
          value={productIds}
          onChange={setProductIds}
          allowOutOfStock
          emptyLabel="All products"
        />
      </div>

      <div className="card chart-card dashboard-chart">
        <h3>Performance</h3>
        <div className="chart-legend">
          <span className="chart-legend-item">
            <span className="legend-dot" style={{ background: COLORS.sales }} />Sales
          </span>
          <span className="chart-legend-item">
            <span className="legend-dot" style={{ background: COLORS.profit }} />Profit
          </span>
          <span className="chart-legend-item">
            <span className="legend-dot" style={{ background: COLORS.items }} />Items sold
          </span>
        </div>
        <div className="chart-body">
          {loading ? (
            <div className="empty-state"><span className="spinner" /></div>
          ) : series.length === 0 ? (
            <div className="empty-state">
              <strong>No data in this range</strong>
              Try a wider date range, or add orders on the Orders page.
            </div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f4" />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDate}
                  tick={{ fontSize: 12, fill: '#8a97a8' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e4e7ec' }}
                  interval="preserveStartEnd"
                  minTickGap={32}
                />
                <YAxis
                  yAxisId="money"
                  tick={{ fontSize: 12, fill: '#8a97a8' }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <YAxis
                  yAxisId="items"
                  orientation="right"
                  tick={{ fontSize: 12, fill: '#8a97a8' }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#cfd6df' }} />
                <Line yAxisId="money" type="monotone" dataKey="sales" name="Sales"
                  stroke={COLORS.sales} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                <Line yAxisId="money" type="monotone" dataKey="profit" name="Profit"
                  stroke={COLORS.profit} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                <Line yAxisId="items" type="monotone" dataKey="items" name="Items sold"
                  stroke={COLORS.items} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="kpis dashboard-kpis">
        <div className="card kpi">
          <div className="label"><span className="dot" style={{ background: COLORS.sales }} />Total Sales</div>
          <div className="value">{money(totals.sales)}</div>
          {!loading && periodDays > 0 && (
            <KpiDelta
              current={totals.sales}
              previous={previousTotals.sales}
              format="money"
              periodDays={periodDays}
            />
          )}
        </div>
        <div className="card kpi">
          <div className="label"><span className="dot" style={{ background: COLORS.profit }} />Profit</div>
          <div className="value">{money(totals.profit)}</div>
          {!loading && periodDays > 0 && (
            <KpiDelta
              current={totals.profit}
              previous={previousTotals.profit}
              format="money"
              periodDays={periodDays}
            />
          )}
        </div>
        <div className="card kpi">
          <div className="label"><span className="dot" style={{ background: COLORS.items }} />Total Items Sold</div>
          <div className="value">{int(totals.items)}</div>
          {!loading && periodDays > 0 && (
            <KpiDelta
              current={totals.items}
              previous={previousTotals.items}
              format="int"
              periodDays={periodDays}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard;
