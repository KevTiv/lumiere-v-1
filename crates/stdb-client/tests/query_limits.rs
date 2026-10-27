use axum::{routing::post, Router};
use stdb_client::StdbClient;

#[tokio::test]
async fn bounded_queries_limit_sql_before_read_and_stream_bytes_before_parsing() {
    let app = Router::new().route(
        "/v1/database/test/sql",
        post(|sql: String| async move {
            assert_eq!(sql, "SELECT id FROM records LIMIT 3");
            "x".repeat(1000)
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let client = StdbClient::new(url, "test".into(), "token".into())
        .with_query_limits(2, 100)
        .unwrap();
    let error = client
        .query_sql("SELECT id FROM records")
        .await
        .unwrap_err();
    assert!(error.to_string().contains("byte bound"));
    task.abort();
}

#[tokio::test]
async fn bounded_queries_reject_error_status_without_consuming_an_unbounded_body() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = [0; 4096];
        socket.read(&mut request).await.unwrap();
        socket
            .write_all(b"HTTP/1.1 503 Service Unavailable\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        // A bounded read must reject the status before waiting for this body.
        std::future::pending::<()>().await;
        drop(socket);
    });
    let client = StdbClient::new(url, "test".into(), "token".into())
        .with_query_limits(2, 100)
        .unwrap();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        client.query_sql("SELECT id FROM records"),
    )
    .await;
    task.abort();
    let error = result
        .expect("error status must reject before reading the body")
        .unwrap_err();
    assert!(error.to_string().contains("bounded query source rejected"));
}
