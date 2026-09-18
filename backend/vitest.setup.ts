// @peculiar/x509 uses tsyringe internally, which throws at import time unless
// this polyfill has already run. A setup file guarantees that regardless of
// which test file imports x509 first, or in what order its own imports run.
import "reflect-metadata";
