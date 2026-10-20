# runtime-hub-link Specification

## Purpose

How the Runtime on a Machine keeps the key that is its identity, finds the Hub it should use, and stays connected to that Hub without anyone restarting it.

## Requirements

### Requirement: The Machine key is created once and kept private
On its first start the Runtime SHALL generate an Ed25519 key pair and store the private key in a file inside the Runtime's folder that only the owning user can read or write. Every later start SHALL reuse that key. The Runtime SHALL refuse to start when the key file can be read or written by anyone else, and SHALL say why.

#### Scenario: First start
- **WHEN** the Runtime starts and its folder holds no key
- **THEN** it creates a key file that only the owning user can read or write

#### Scenario: Restart
- **WHEN** the Runtime starts again with the same folder
- **THEN** it uses the same public key as before

#### Scenario: Key file opened up to others
- **WHEN** the key file is readable by users other than its owner
- **THEN** the Runtime refuses to start and names the file and the permissions it expects

### Requirement: The Hub URL is configurable
The Runtime SHALL connect to the Hub URL from its configuration, and an environment variable SHALL override it. When neither sets a Hub URL, the Runtime SHALL exit with an error that names both.

#### Scenario: Hub URL from configuration
- **WHEN** the configuration sets a Hub URL
- **THEN** the Runtime connects to that Hub

#### Scenario: Environment overrides configuration
- **WHEN** both the configuration and the environment variable set a Hub URL
- **THEN** the Runtime connects to the one from the environment

#### Scenario: No Hub URL
- **WHEN** neither sets a Hub URL
- **THEN** the Runtime exits with an error naming the configuration key and the environment variable

### Requirement: The Runtime proves its key to the Hub
The Runtime SHALL answer the Hub's challenge as hub-connection describes, using the Machine key. When the Hub sends a ready frame, the Runtime SHALL report that it is connected and which Machine the Hub sees. When the Hub rejects it, the Runtime SHALL report the reason and keep retrying with backoff.

#### Scenario: Accepted
- **WHEN** the Hub knows the Machine key
- **THEN** the Runtime reports it is connected, with the Machine named in the ready frame

#### Scenario: Rejected
- **WHEN** the Hub closes the connection with an authentication error
- **THEN** the Runtime reports the reason and tries again later with backoff

### Requirement: The Runtime reconnects by itself
When its connection to the Hub drops or cannot be opened, the Runtime SHALL keep trying to reconnect with exponential backoff, randomized and capped, and SHALL reset the backoff after a successful connection. It SHALL NOT need a restart to recover.

#### Scenario: Hub restarts
- **WHEN** the Hub restarts while the Runtime is connected
- **THEN** the Runtime reconnects and authenticates again once the Hub is back, without being restarted

#### Scenario: Hub stays down
- **WHEN** the Hub stays unreachable
- **THEN** the wait between attempts grows up to the cap and stays there
