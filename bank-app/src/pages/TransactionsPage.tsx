import Layout from "../components/Layout";

const transactions = [
  {
    id: "txn-1001",
    memberId: "12345",
    account: "****4521",
    type: "Deposit",
    amount: 500,
    date: "09/14/2026",
    status: "Completed",
  },
  {
    id: "txn-1002",
    memberId: "12345",
    account: "****1883",
    type: "Withdrawal",
    amount: -85.5,
    date: "09/13/2026",
    status: "Completed",
  },
  {
    id: "txn-1003",
    memberId: "23456",
    account: "****7721",
    type: "Deposit",
    amount: 1200,
    date: "09/12/2026",
    status: "Completed",
  },
];

export default function TransactionsPage() {
  return (
    <Layout>
      <h2>Transactions</h2>

      <section className="panel">
        <div className="panel-header">
          Recent Transactions
        </div>

        <table>
          <thead>
            <tr>
              <th>Transaction ID</th>
              <th>Member</th>
              <th>Account</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td>{transaction.id}</td>
                <td>{transaction.memberId}</td>
                <td>{transaction.account}</td>
                <td>{transaction.type}</td>

                <td>
                  $
                  {transaction.amount.toLocaleString(
                    "en-US",
                    {
                      minimumFractionDigits: 2,
                    },
                  )}
                </td>

                <td>{transaction.date}</td>
                <td>{transaction.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Layout>
  );
}