FROM scratch
ARG PROOF_ID
LABEL kr.wonseoro.admission-proof.run=${PROOF_ID}
CMD ["/unsigned-control-must-not-run"]
