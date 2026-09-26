#!/usr/bin/env bash
# Record "Use AWS" on an EC2 instance: the program that names the "platform"
# credential, run where the only identity is the instance's role.
#
#     LM15_CLOUD_CREDS=/path/to/private/dir scripts/capture-aws-ec2.sh
#
# Creates, in us-east-1 and in the account of LM15_CLOUD_CREDS's default
# profile: an IAM role allowed to call Bedrock models and nothing else, its
# instance profile, a key pair, a security group open to this machine's
# address on port 22, and one Ubuntu 24.04 instance (c7i.xlarge, IMDSv2
# only). It installs Python, Node and Rust there, builds the SDKs from the
# checkouts beside this repository, runs scripts/capture-cloud.py aws
# --remote for the _ec2 steps, and deletes everything it created, also when
# a step fails. About ten minutes and a few cents.
set -euo pipefail

: "${LM15_CLOUD_CREDS:?set LM15_CLOUD_CREDS (see scripts/capture-cloud.py)}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SDKS=$(dirname "$ROOT")
REGION=us-east-1
NAME="lm15-docs-ec2-$(date +%Y%m%d%H%M%S)"
WORK=$(mktemp -d)
chmod 700 "$WORK"
AWS_BIN=$(nix shell nixpkgs#awscli2 -c sh -c 'command -v aws')
aws() { HOME="$LM15_CLOUD_CREDS" "$AWS_BIN" --region "$REGION" --output text "$@"; }
say() { printf '\n== %s\n' "$*"; }

INSTANCE='' SG='' KEY='' ROLE=''
cleanup() {
  set +e
  say "deleting what this run created"
  [[ -n $INSTANCE ]] && aws ec2 terminate-instances --instance-ids "$INSTANCE" >/dev/null && aws ec2 wait instance-terminated --instance-ids "$INSTANCE"
  [[ -n $SG ]] && aws ec2 delete-security-group --group-id "$SG"
  [[ -n $KEY ]] && aws ec2 delete-key-pair --key-name "$KEY"
  if [[ -n $ROLE ]]; then
    aws iam remove-role-from-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
    aws iam delete-instance-profile --instance-profile-name "$ROLE"
    aws iam delete-role-policy --role-name "$ROLE" --policy-name bedrock-invoke
    aws iam delete-role --role-name "$ROLE"
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

say "role $NAME: Bedrock model calls only"
aws iam create-role --role-name "$NAME" --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
ROLE=$NAME
aws iam put-role-policy --role-name "$ROLE" --policy-name bedrock-invoke --policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"],"Resource":"*"}]}'
aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"

say "key pair and security group"
ssh-keygen -q -t ed25519 -N '' -f "$WORK/key"
aws ec2 import-key-pair --key-name "$NAME" --public-key-material "fileb://$WORK/key.pub" >/dev/null
KEY=$NAME
VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId')
SG=$(aws ec2 create-security-group --group-name "$NAME" --description "lm15 docs capture" --vpc-id "$VPC" --query GroupId)
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$(curl -s https://checkip.amazonaws.com)/32" >/dev/null

say "instance"
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value)
for attempt in 1 2 3 4 5 6; do
  # a new instance profile takes a few seconds to be usable
  INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type c7i.xlarge --key-name "$KEY" \
    --security-group-ids "$SG" --iam-instance-profile "Name=$ROLE" \
    --metadata-options HttpTokens=required,HttpEndpoint=enabled \
    --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=30,VolumeType=gp3}' \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' 2>/dev/null) && break
  sleep 10
done
[[ -n $INSTANCE ]] || { echo "could not start an instance"; exit 1; }
aws ec2 wait instance-running --instance-ids "$INSTANCE"
IP=$(aws ec2 describe-instances --instance-ids "$INSTANCE" --query 'Reservations[0].Instances[0].PublicIpAddress')
SSH_OPTIONS="-i $WORK/key -o UserKnownHostsFile=$WORK/known_hosts -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
DEST="ubuntu@$IP"
for attempt in $(seq 30); do ssh $SSH_OPTIONS -o BatchMode=yes "$DEST" true 2>/dev/null && break; sleep 5; done

say "the SDKs, from the checkouts"
(cd "$SDKS/lm15-python" && uv build -q --wheel --out-dir "$WORK/dist")
(cd "$SDKS/lm15-ts" && npm pack --silent --pack-destination "$WORK/dist" >/dev/null)
tar -C "$SDKS" --exclude=target --exclude=.git -czf "$WORK/dist/lm15-rs.tgz" lm15-rs
scp -q $SSH_OPTIONS "$WORK"/dist/* "$DEST:"
scp -q $SSH_OPTIONS "$ROOT/src/data/aws/platform.rs" "$DEST:warm.rs"

say "Python, Node and Rust on the instance"
ssh $SSH_OPTIONS "$DEST" bash -s <<'REMOTE'
set -euo pipefail
sudo apt-get -qq update >/dev/null
sudo DEBIAN_FRONTEND=noninteractive apt-get -qq install -y python3-venv build-essential >/dev/null
python3 -m venv venv && venv/bin/pip install -q lm15-*.whl
NODE=$(curl -s https://nodejs.org/dist/latest-v22.x/ | grep -o 'node-v22[^"]*-linux-x64.tar.xz' | head -1)
mkdir node && curl -s "https://nodejs.org/dist/latest-v22.x/$NODE" | tar -xJ --strip-components=1 -C node
curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal >/dev/null
mkdir lm15-rs-src && tar -xzf lm15-rs.tgz -C lm15-rs-src
mkdir -p run/py run/ts run/go run/rs/src
(cd run/ts && echo '{"type": "module", "private": true}' > package.json && PATH=$HOME/node/bin:$PATH npm install -s ../../lm15-lm15-*.tgz)
cat > run/rs/Cargo.toml <<TOML
[package]
name = "docs"
version = "0.0.0"
edition = "2021"

[dependencies]
lm15 = { path = "$HOME/lm15-rs-src/lm15-rs" }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }

[workspace]
TOML
cp warm.rs run/rs/src/main.rs && (cd run/rs && ~/.cargo/bin/cargo build --release -q)
echo ready
REMOTE

say "recording"
LM15_REMOTE_SSH_OPTIONS="$SSH_OPTIONS" \
LM15_REMOTE_WHERE="an EC2 instance (Ubuntu 24.04, $REGION) whose only identity is an instance role allowed bedrock:InvokeModel" \
  python3 "$ROOT/scripts/capture-cloud.py" aws --remote "$DEST" --only platform_ec2 --only platform_ec2_no_region
