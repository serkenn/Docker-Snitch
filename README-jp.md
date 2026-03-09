# Docker Snitch

Little Snitch にインスパイアされた Docker コンテナ **およびホストシステム** 用ネットワークモニター。Web GUI を通じて、すべてのネットワーク通信をキャプチャ・可視化・制御します。

## 機能

- **リアルタイム接続監視** -- コンテナとホストプロセスの全 TCP/UDP 接続を表示
- **ホストレベル監視** -- systemd エージェントが conntrack 経由で Ubuntu システム全体の通信を監視、プロセス名を特定（`[sshd]`、`[tailscaled]` 等）
- **ワールドマップ** -- OpenStreetMap / Leaflet によるマルチホップトポロジー可視化（Peers → Mullvad → GCP → Tailnet → NAS）
- **トレントピア追跡** -- qBittorrent API 連携で個別ピアの IP・国・ISP・DL/UL 速度・転送量を表示
- **GeoIP 解決** -- ip-api.com 経由で国・都市・ISP・ASN・緯度経度を自動解決（サーバー自身の Public IP も自動検出）
- **トラフィック分類** -- Tailnet、GCP、Mullvad VPN、Cloudflare、AWS、Azure、Hetzner、OVH、Internet に自動分類
- **コンテナ単位のフィルタリング** -- クリック / Cmd+クリックで複数コンテナを選択し合計トラフィックを表示
- **ネットワークマップ** -- カテゴリ別 Mermaid トポロジー図（帯域幅内訳付き）
- **ファイアウォールルール** -- コンテナ・リモートホスト・ポート・プロトコル単位の許可/ブロック
- **パッシブ DNS** -- DNS レスポンスのスニッフィングによる IP→ドメイン名解決
- **トラフィックチャート** -- Recharts によるコンテナ単位の帯域幅グラフ
- **WebSocket ライブ更新** -- パケットが流れるたびにリアルタイム更新
- **ワンコマンドセットアップ** -- `serversetup.sh` で Ubuntu サーバーに全自動構築

## アーキテクチャ

```
                                         ┌──────────────────┐
                                         │  ip-api.com      │
                                         │  (GeoIP)         │
                                         └────────┬─────────┘
                                                  │
┌──────────────────┐   ┌──────────────────────────┴──────────────────────┐
│  ホストエージェント│──>│  Monitor コンテナ (Go)                          │
│  (systemd)       │   │  ┌──────────┐ ┌────────────┐ ┌───────────────┐ │
│  conntrack +     │   │  │ REST API │ │  NFQUEUE   │ │ qBittorrent   │ │
│  プロセス特定    │   │  │ + WS Hub │ │  Capture   │ │ API Client    │ │
└──────────────────┘   │  └──────────┘ └────────────┘ └───────────────┘ │
                       │  ┌──────────┐ ┌────────────┐ ┌───────────────┐ │
┌──────────────────┐   │  │ ルール  │ │ コンテナ   │ │ GeoIP + サーバ│ │
│  Frontend        │──>│  │ エンジン │ │ 解決       │ │ 位置自動検出  │ │
│  React/Vite      │   │  └──────────┘ └────────────┘ └───────────────┘ │
│  Leaflet + OSM   │   │  ┌──────────┐ ┌────────────┐                   │
│  port 9080       │   │  │  SQLite  │ │ パッシブDNS│                   │
└──────────────────┘   │  └──────────┘ └────────────┘                   │
                       └──────────────────────┬──────────────────────────┘
                                              │
                              ┌────────────────┼────────────────┐
                    iptables DOCKER-USER   /proc/net/nf_conntrack
                              │                                 │
                    ┌─────────┴───────────┐    ┌────────────────┴──┐
                    │  Docker コンテナ      │    │  ホストプロセス    │
                    │  qbittorrent,gluetun │    │  sshd, tailscaled  │
                    │  nginx 等            │    │  apt, systemd      │
                    └─────────────────────┘    └───────────────────┘
```

### 仕組み

**コンテナ監視 (NFQUEUE):**

1. Monitor コンテナが `network_mode: host` と `NET_ADMIN` 権限で起動
2. `DOCKER-USER` チェーンに `--queue-bypass` 付きで iptables ルールを挿入
3. Docker ブリッジを通過する全パケットを NFQUEUE 経由で Go プログラムに配信
4. Docker API でコンテナを特定、ルール照合後 ACCEPT / DROP を発行
5. WebSocket で接続イベントをブロードキャスト

**ホスト監視 (conntrack エージェント):**

1. 軽量 Go バイナリが systemd サービスとしてホスト上で動作
2. 2秒ごとに `/proc/net/nf_conntrack` をポーリングし全トラッキング中の接続を取得
3. `/proc/net/tcp` の inode を `/proc/[pid]/fd` にマッピングしてプロセス名を特定
4. 接続データ（プロセス名・バイトカウント付き）を Monitor の `/api/host-events` に POST
5. Monitor が GeoIP で情報を付加し、コンテナの接続と一緒にブロードキャスト

**トレントピア追跡 (qBittorrent API):**

1. Monitor がオプションで qBittorrent の Web API に接続
2. アクティブな全トレントのピアリストを取得
3. 各ピアの IP を GeoIP で緯度経度に解決
4. フロントエンドがワールドマップ上に Mullvad VPN Exit 経由でピアを表示

## クイックスタート

### 自動サーバーセットアップ (Ubuntu)

```bash
git clone https://github.com/serkenn/Docker-Snitch.git
cd Docker-Snitch
sudo bash scripts/serversetup.sh
```

Docker のインストールから全サービスの起動（ホストエージェント含む）まで全自動で行います。

### 手動セットアップ

```bash
# .env.example をコピーして設定
cp .env.example .env
# .env を編集して qBittorrent の URL/認証情報を設定（任意）

docker compose up --build
```

ブラウザで **http://localhost:9080** を開きます。

### サンプルコンテナでテスト

```bash
docker run -d --name nginx-test nginx
docker run -d --name curl-test curlimages/curl sleep 3600
docker exec curl-test curl -s https://example.com
docker exec curl-test curl -s https://api.github.com
```

## Web GUI

### 接続タブ (Connections)

コンテナとホストプロセスの全アクティブ接続をリアルタイム表示:

| カラム    | 説明                                            |
| --------- | ----------------------------------------------- |
| Container | コンテナ名 またはホストプロセス `[process名]`   |
| Dir       | アウトバウンド (↑) またはインバウンド (↓)       |
| Remote    | ドメイン名または IP アドレス                    |
| Port      | リモートポート番号                              |
| Proto     | TCP / UDP                                       |
| Location  | 国旗、都市、国名                                |
| ISP / Org | ISP または組織名                                |
| Type      | カテゴリバッジ（Tailnet、GCP、Mullvad、AWS 等） |
| Action    | 許可 (緑) またはブロック (赤)                   |
| Sent/Recv | 転送バイト数                                    |
| Duration  | 接続の継続時間                                  |

**Block** ボタンでブロックルールを作成できます。

### ワールドマップタブ (World Map)

OpenStreetMap 上のマルチホップネットワークトポロジー（CARTO Dark Matter タイル）:

- **GCP サーバー** マーカー（Public IP の GeoIP から自動検出）
- **Mullvad VPN Exit** ノード（中間ホップ、緑色）
- **トレントピア** が Mullvad 経由で接続、ピアごとの DL/UL 統計付き（黄色）
- **Tailnet** エンドポイント（紫色）
- **直接インターネット接続**
- トラフィック量に応じた太さの曲線アーク
- ピアテーブル: IP、国、都市、ISP、クライアント、DL/UL 速度、進捗率、トレント名
- 統計バー: 合計ピア数、DL/UL 速度、Mullvad Exit 数

### ネットワークマップタブ (Network Map)

Mermaid トポロジーダイアグラム:
- カテゴリ別サブグラフ（帯域幅内訳カード付き）
- 各エッジのトラフィック量
- ブロック接続は赤でハイライト

### ルールタブ (Rules)

| フィールド  | 値                                       |
| ----------- | ---------------------------------------- |
| Container   | コンテナ名 または `*`（全コンテナ）      |
| Direction   | outbound / inbound / both                |
| Remote Host | IP、CIDR（例: `10.0.0.0/8`）、または `*` |
| Remote Port | ポート番号 または `0`（全ポート）        |
| Protocol    | tcp / udp / `*`                          |
| Action      | allow / block                            |
| Priority    | 数値が小さいほど優先度が高い             |

ルールは優先度順に評価、最初のマッチが適用。デフォルトは **allow**。

## 設定

### Monitor コンテナ（環境変数）

| 変数                    | デフォルト値      | 説明                                     |
| ----------------------- | ----------------- | ---------------------------------------- |
| `SNITCH_DB_PATH`        | `/data/snitch.db` | SQLite データベースのパス                |
| `SNITCH_API_PORT`       | `9645`            | API サーバーのポート                     |
| `SNITCH_DEFAULT_ACTION` | `allow`           | ルール未マッチ時のデフォルト判定         |
| `SNITCH_QUEUE_NUM`      | `0`               | NFQUEUE のキュー番号                     |
| `SNITCH_QBIT_URL`       | (空)              | qBittorrent Web API URL（例: `http://localhost:8080`）|
| `SNITCH_QBIT_USER`      | `admin`           | qBittorrent ユーザー名                   |
| `SNITCH_QBIT_PASS`      | (空)              | qBittorrent パスワード                   |

### ホストエージェント（systemd ユニットの環境変数）

| 変数                    | デフォルト値                  | 説明                      |
| ----------------------- | ----------------------------- | ------------------------- |
| `SNITCH_MONITOR_URL`    | `http://127.0.0.1:9645`      | Monitor API の URL        |
| `SNITCH_POLL_INTERVAL`  | `2`                           | conntrack ポーリング間隔（秒）|

## プロジェクト構成

```
├── docker-compose.yml
├── .env.example                    # qBittorrent 設定テンプレート
├── scripts/
│   ├── serversetup.sh              # Ubuntu サーバー全自動セットアップ
│   ├── deploy.sh                   # GCP VM デプロイスクリプト
│   └── snitch-host-agent.service   # ホストエージェント systemd ユニット
├── monitor/                        # Go バックエンド
│   ├── Dockerfile                  # Monitor コンテナイメージ
│   ├── Dockerfile.agent            # ホストエージェントバイナリビルダー
│   ├── cmd/
│   │   ├── monitor/main.go         # Monitor エントリーポイント
│   │   └── hostagent/main.go       # ホストエージェント
│   └── internal/
│       ├── capture/                # NFQUEUE パケットキャプチャ
│       ├── containers/             # Docker API コンテナ解決
│       ├── conntrack/              # DNS キャッシュ + GeoIP + サーバー位置検出
│       ├── qbit/                   # qBittorrent API クライアント
│       ├── rules/                  # ルールエンジン + SQLite ストア
│       ├── api/                    # REST API + WebSocket + ホストイベント受信
│       └── db/                     # データベース初期化 + マイグレーション
└── frontend/                       # React Web GUI
    ├── Dockerfile
    └── src/
        ├── components/
        │   ├── ConnectionTable     # リアルタイム接続テーブル
        │   ├── ContainerList       # 複数選択対応コンテナサイドバー
        │   ├── WorldMap            # マルチホップトポロジーマップ + ピアテーブル
        │   ├── NetworkMap          # Mermaid トポロジーダイアグラム
        │   ├── TrafficChart        # 帯域幅チャート
        │   ├── RuleList            # ルール管理
        │   └── RuleEditor          # ルール作成/編集モーダル
        ├── api/                    # REST + WebSocket クライアント
        └── types/                  # TypeScript 型定義
```

## API エンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/connections` | 全アクティブ接続（コンテナ + ホスト） |
| GET | `/api/containers` | Docker コンテナ一覧 |
| GET | `/api/stats` | サマリー統計 |
| GET | `/api/peers` | トレントピア（qBittorrent 必須） |
| GET | `/api/torrents` | トレント一覧（qBittorrent 必須） |
| GET | `/api/server-location` | サーバーの Public IP と位置情報 |
| POST | `/api/host-events` | ホストエージェントからの接続データ受信 |
| GET | `/api/rules` | ルール一覧 |
| POST | `/api/rules` | ルール作成 |
| PUT | `/api/rules/:id` | ルール更新 |
| DELETE | `/api/rules/:id` | ルール削除 |
| GET | `/api/ws` | リアルタイムイベント用 WebSocket |

## 制限事項

- IPv4 のみ対応（IPv6 は予定）
- ホストエージェントは conntrack カーネルモジュールのある Linux が必要
- macOS の Docker Desktop では `network_mode: host` は Linux VM のホストを意味する
- NFQUEUE にはスループットの上限があり、10Gbps 以上のトラフィックには不向き
- ip-api.com の無料枠は 45 リクエスト/分のレート制限あり

## ライセンス

MIT
