export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 40, maxWidth: 640 }}>
      <h1>Handyman</h1>
      <p>
        Витрина магазина будет здесь на следующих этапах. Сейчас готова только
        основа: база данных и вход в{" "}
        <a href="/admin/login">админку</a>.
      </p>
    </main>
  );
}
