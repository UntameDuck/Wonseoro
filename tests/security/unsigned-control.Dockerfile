FROM scratch
ARG PROOF_ID
LABEL kr.wonseoro.admission-proof.run=${PROOF_ID}
USER 65532:65532
CMD ["/unsigned-control-must-not-run"]
